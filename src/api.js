import OpenAI from 'openai';
import chalk from 'chalk';
import { getProvider } from './providers.js';

/**
 * Создать OpenAI-совместимый клиент для указанного провайдера
 *
 * @param {string} apiKey - API-ключ
 * @param {string} [providerId='openrouter'] - Идентификатор провайдера
 * @returns {OpenAI}
 */
export function createClient(apiKey, providerId = 'openrouter') {
  const provider = getProvider(providerId);
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: apiKey,
    defaultHeaders: provider.headers || {},
    maxRetries: 1,
    timeout: 600000
  });
}

const THINK_TAG_PAIRS = [
  { open: '<think>', close: '</think>' },
  { open: '<thought>', close: '</thought>' }
];
const ALL_OUTSIDE_TAGS = THINK_TAG_PAIRS.flatMap(p => [p.open, p.close]);
const MAX_OUTSIDE_TAG_LEN = Math.max(...ALL_OUTSIDE_TAGS.map(t => t.length));

/**
 * Создает потоковый фильтр тегов рассуждений (<think>...</think> и <thought>...</thought>),
 * поддерживающий разрыв тегов между чанками и отбрасывающий осиротевшие закрывающие теги.
 *
 * @param {(text: string) => void} onText - Колбэк для текста вне блока рассуждений
 * @param {(think: string) => void} onThink - Колбэк для текста внутри блока рассуждений
 * @returns {{ push: (chunk: string) => void, end: () => void }}
 */
export function createThinkFilter(onText, onThink) {
  let inThink = false;
  let activeCloseTag = null;
  let pending = '';

  function processBuffer() {
    while (pending.length > 0) {
      if (!inThink) {
        let earliest = null;
        for (const pair of THINK_TAG_PAIRS) {
          const openIdx = pending.indexOf(pair.open);
          if (openIdx !== -1 && (earliest === null || openIdx < earliest.index)) {
            earliest = { index: openIdx, tag: pair.open, type: 'open', pair };
          }
          const closeIdx = pending.indexOf(pair.close);
          if (closeIdx !== -1 && (earliest === null || closeIdx < earliest.index)) {
            earliest = { index: closeIdx, tag: pair.close, type: 'close', pair };
          }
        }

        if (earliest !== null) {
          const before = pending.slice(0, earliest.index);
          if (before) onText(before);
          pending = pending.slice(earliest.index + earliest.tag.length);

          if (earliest.type === 'open') {
            inThink = true;
            activeCloseTag = earliest.pair.close;
          }
          // Если earliest.type === 'close' (осиротевший закрывающий тег вне блока рассуждений),
          // просто отбрасываем его без вывода пользователю
          continue;
        }

        // Проверяем, является ли суффикс pending началом какого-то из открывающих или закрывающих тегов
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, MAX_OUTSIDE_TAG_LEN - 1);
        for (let len = maxCheck; len >= 1; len--) {
          const suffix = pending.slice(-len);
          if (ALL_OUTSIDE_TAGS.some(t => t.startsWith(suffix))) {
            matchLen = len;
            break;
          }
        }

        if (matchLen > 0) {
          const emit = pending.slice(0, pending.length - matchLen);
          if (emit) onText(emit);
          pending = pending.slice(-matchLen);
          break;
        } else {
          onText(pending);
          pending = '';
          break;
        }
      } else {
        const idx = pending.indexOf(activeCloseTag);
        if (idx !== -1) {
          const before = pending.slice(0, idx);
          if (before) onThink(before);
          pending = pending.slice(idx + activeCloseTag.length);
          inThink = false;
          activeCloseTag = null;
          continue;
        }

        // Проверяем, является ли суффикс pending префиксом активного закрывающего тега
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, activeCloseTag.length - 1);
        for (let len = maxCheck; len >= 1; len--) {
          if (activeCloseTag.startsWith(pending.slice(-len))) {
            matchLen = len;
            break;
          }
        }

        if (matchLen > 0) {
          const emit = pending.slice(0, pending.length - matchLen);
          if (emit) onThink(emit);
          pending = pending.slice(-matchLen);
          break;
        } else {
          onThink(pending);
          pending = '';
          break;
        }
      }
    }
  }

  return {
    push(chunk) {
      if (!chunk) return;
      pending += chunk;
      processBuffer();
    },
    end() {
      if (pending.length > 0) {
        if (!inThink) {
          onText(pending);
        } else {
          onThink(pending);
        }
        pending = '';
      }
      inThink = false;
      activeCloseTag = null;
    }
  };
}

/**
 * Создать состояние для накопления потоковых вызовов инструментов (tool calls).
 *
 * @returns {{ calls: Array<object>, byIndex: Map<number, object> }}
 */
export function createToolCallState() {
  return {
    calls: [],
    byIndex: new Map()
  };
}

/**
 * Накопить дельту вызова инструмента (tool call) в состояние.
 * Поддерживает как стандартный OpenAI-формат с числовым индексом tc.index,
 * так и Google Gemini (OpenAI-compat), который не присылает index,
 * передавая отдельные вызовы с собственным id.
 *
 * @param {{ calls: Array<object>, byIndex: Map<number, object> }} state - Состояние накопления
 * @param {object} tc - Дельта вызова инструмента из chunk.choices[0].delta.tool_calls
 * @returns {object} Накопленный объект вызова инструмента
 */
export function accumulateToolCallDelta(state, tc) {
  let slot;
  if (typeof tc.index === 'number') {
    slot = state.byIndex.get(tc.index);
    if (!slot) {
      slot = {
        id: tc.id || '',
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: ''
        }
      };
      state.calls.push(slot);
      state.byIndex.set(tc.index, slot);
    }
  } else {
    const lastCall = state.calls.length > 0 ? state.calls[state.calls.length - 1] : null;
    if (!lastCall || (tc.id && lastCall.id && lastCall.id !== tc.id)) {
      slot = {
        id: tc.id || '',
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: ''
        }
      };
      state.calls.push(slot);
    } else {
      slot = lastCall;
    }
  }

  if (tc.id) slot.id = tc.id;
  if (tc.function?.name) {
    slot.function.name = tc.function.name;
  }
  if (tc.function?.arguments) {
    slot.function.arguments += tc.function.arguments;
  }
  if (tc.extra_content) {
    // Gemini 3.x требует сохранения extra_content (thought_signature) в истории для вызовов функций
    const prev = slot.extra_content;
    slot.extra_content = {
      ...prev,
      ...tc.extra_content,
      google: {
        ...prev?.google,
        ...tc.extra_content.google
      }
    };
  }

  return slot;
}

/**
 * Stream a chat completion with conciseness filters.
 *
 * @param {object} params
 * @param {string} [params.provider='openrouter']
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {Array<object>} params.messages
 * @param {Array<object>} [params.tools]
 * @param {number} [params.maxTokens]
 * @param {number} [params.temperature=0.4]
 * @param {string} [params.reasoningEffort='auto']
 * @param {number} [params.firstChunkTimeoutMs=60000]
 * @param {AbortSignal} [params.signal]
 * @param {(think: string) => void} [params.onReasoning]
 * @param {(text: string) => void} [params.onChunk]
 * @param {(warning: string) => void} [params.onWarning]
 * @param {(modelId: string) => void} [params.onModel]
 * @returns {Promise<{ content: string, toolCalls: Array<object>|null, usage: object|null, routedModel: string }>}
 */
export async function streamChatCompletion({
  provider = 'openrouter',
  apiKey,
  model,
  messages,
  tools,
  maxTokens,
  temperature = 0.4,
  reasoningEffort = 'auto',
  firstChunkTimeoutMs = 60000,
  signal,
  onReasoning,
  onChunk,
  onWarning,
  onModel
}) {
  if (!apiKey) {
    throw new Error('Ключ API не настроен — выполните /login');
  }

  const client = createClient(apiKey, provider);

  const requestPayload = {
    model: model,
    messages: messages,
    temperature: temperature,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (maxTokens) {
    requestPayload.max_tokens = maxTokens;
  }
  if (tools && tools.length > 0) {
    requestPayload.tools = tools;
  }
  if (reasoningEffort && reasoningEffort !== 'auto') {
    if (provider === 'google') {
      requestPayload.reasoning_effort = reasoningEffort;
    } else {
      requestPayload.reasoning = { effort: reasoningEffort };
    }
  }

  const internalController = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    internalController.abort();
  };

  if (signal) {
    if (signal.aborted) {
      internalController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let timer = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, firstChunkTimeoutMs);

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  let fullResponse = '';
  let inThinkingProcess = false;
  let thinkingProcessBuffer = '';
  let usage = null;
  let routedModel = '';
  let modelReported = false;
  const state = createToolCallState();

  const thinkFilter = createThinkFilter(
    (text) => {
      fullResponse += text;
      if (typeof onChunk === 'function') {
        onChunk(text);
      }
    },
    (think) => {
      if (typeof onReasoning === 'function') {
        onReasoning(think);
      }
    }
  );

  try {
    let stream;
    while (true) {
      try {
        stream = await client.chat.completions.create(requestPayload, { signal: internalController.signal });
        break;
      } catch (err) {
        if (timedOut) {
          throw err;
        }

        const msg = (err.message || '').toLowerCase();
        const hasReasoning = msg.includes('thinking level') || msg.includes('reasoning');
        const hasEffortUnsupported = (hasReasoning && msg.includes('not supported')) ||
          ((err.status === 400 || err.statusCode === 400) && hasReasoning && msg.includes('support'));

        if ((requestPayload.reasoning_effort || requestPayload.reasoning) && hasEffortUnsupported) {
          delete requestPayload.reasoning_effort;
          delete requestPayload.reasoning;
          if (typeof onWarning === 'function') {
            onWarning(`Модель не поддерживает уровень рассуждений «${reasoningEffort}» — запрос без него.`);
          }
          continue;
        }

        const hasToolOrFunc = msg.includes('tool') || msg.includes('function');
        const hasToolSupport = msg.includes('support');

        if (requestPayload.tools && hasToolOrFunc && hasToolSupport) {
          delete requestPayload.tools;
          if (typeof onWarning === 'function') {
            onWarning('Модель не поддерживает инструменты — ответ без доступа к файлам.');
          }
          continue;
        }

        throw err;
      }
    }

    for await (const chunk of stream) {
      clearTimer();

      if (chunk.model) {
        // Google returns ids as "models/<id>"
        routedModel = chunk.model.replace(/^models\//, '');
        if (!modelReported) {
          modelReported = true;
          if (typeof onModel === 'function') {
            onModel(routedModel);
          }
        }
      }

      if (chunk.usage) {
        usage = chunk.usage;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Accumulate tool calls if any
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          accumulateToolCallDelta(state, tc);
        }
      }

      // Forward reasoning tokens (DeepSeek R1, Nemotron, etc.)
      if (delta.reasoning) {
        if (typeof onReasoning === 'function') {
          onReasoning(delta.reasoning);
        }
      }

      if (delta.content) {
        let content = delta.content;

        // Suppress plain-text thinking process preamble (e.g. from Nemotron)
        if (!fullResponse && !thinkingProcessBuffer && /Here\x27s a thinking process:/i.test(content)) {
          inThinkingProcess = true;
        }

        if (inThinkingProcess) {
          thinkingProcessBuffer += content;
          if (/\n\n(```|<!|[А-Яа-я#]|Here is|Вот)/.test(content)) {
            inThinkingProcess = false;
            content = content.replace(/^[\s\S]*?\n\n(?=```|<!|[А-Яа-я#]|Here is|Вот)/, '');
            thinkingProcessBuffer = '';
          } else {
            if (typeof onReasoning === 'function') {
              onReasoning(content);
            }
            continue;
          }
        }

        if (content) {
          thinkFilter.push(content);
        }
      }
    }

    // The openai SDK ends the stream quietly on abort instead of throwing,
    // which would pass a cancelled or timed-out reply off as a finished one
    if (internalController.signal.aborted) {
      const abortErr = new Error('Request was aborted.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  } catch (err) {
    if (timedOut) {
      const timeoutErr = new Error(`Модель ${model} не ответила за ${Math.round(firstChunkTimeoutMs / 1000)} с — вероятно, перегружена у провайдера. Выберите другую через /model`);
      timeoutErr.code = 'FIRST_CHUNK_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimer();
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (inThinkingProcess && thinkingProcessBuffer) {
    inThinkingProcess = false;
    thinkFilter.push(thinkingProcessBuffer);
    thinkingProcessBuffer = '';
  }

  thinkFilter.end();

  const toolCalls = state.calls;

  return {
    content: fullResponse,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage,
    routedModel
  };
}

/**
 * Получить актуальную информацию о ключе и доступных лимитах/остатке
 *
 * @param {string} apiKey - API-ключ
 * @param {string} [provider='openrouter'] - Идентификатор провайдера
 * @returns {Promise<object|null>}
 */
export async function fetchKeyInfo(apiKey, provider = 'openrouter') {
  if (!apiKey || provider === 'google') return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/duddy-cli',
        'X-Title': 'Duddy CLI'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

const googleContextCache = {};
let modelsContextCache = null;

/**
 * Получить максимальное окно контекста (лимит токенов) для модели
 *
 * @param {string} [modelId=''] - Идентификатор модели
 * @param {string} [provider='openrouter'] - Идентификатор провайдера
 * @param {string} [apiKey=''] - API-ключ (необходим для запроса лимитов Google)
 * @returns {Promise<number>}
 */
export async function getModelContextLength(modelId = '', provider = 'openrouter', apiKey = '') {
  if (provider === 'google') {
    if (googleContextCache[modelId]) {
      return googleContextCache[modelId];
    }
    if (apiKey) {
      try {
        const cleanId = modelId.replace(/^models\//, '');
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanId)}`, {
          headers: {
            'x-goog-api-key': apiKey
          },
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const json = await res.json();
          if (json && typeof json.inputTokenLimit === 'number') {
            googleContextCache[modelId] = json.inputTokenLimit;
            return json.inputTokenLimit;
          }
        }
      } catch {}
    }
    return 1000000;
  }

  if (!modelsContextCache) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const json = await res.json();
        modelsContextCache = {};
        for (const m of json.data || []) {
          if (m.id && m.context_length) {
            modelsContextCache[m.id] = m.context_length;
          }
        }
      }
    } catch {}
  }

  if (modelsContextCache && modelsContextCache[modelId]) {
    return modelsContextCache[modelId];
  }

  const m = (modelId || '').toLowerCase();
  if (m.includes('gemini') || m.includes('gemma')) return 1000000;
  if (m.includes('free')) return 200000;
  if (m.includes('claude')) return 200000;
  if (m.includes('gpt-4.1') || m.includes('o3') || m.includes('o1')) return 1000000;
  if (m.includes('gpt-4') || m.includes('llama')) return 128000;
  if (m.includes('deepseek')) return 64000;
  return 1000000;
}


