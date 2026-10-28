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

/**
 * Создает потоковый фильтр тегов <think>...</think>, поддерживающий
 * разрыв тегов между чанками.
 *
 * @param {(text: string) => void} onText - Колбэк для текста вне блока <think>
 * @param {(think: string) => void} onThink - Колбэк для текста внутри блока <think>
 * @returns {{ push: (chunk: string) => void, end: () => void }}
 */
export function createThinkFilter(onText, onThink) {
  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';
  let inThink = false;
  let pending = '';

  function processBuffer() {
    while (pending.length > 0) {
      if (!inThink) {
        const idx = pending.indexOf(OPEN_TAG);
        if (idx !== -1) {
          const before = pending.slice(0, idx);
          if (before) onText(before);
          pending = pending.slice(idx + OPEN_TAG.length);
          inThink = true;
          continue;
        }

        // Проверяем, является ли суффикс pending префиксом <think>
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, OPEN_TAG.length - 1);
        for (let len = maxCheck; len >= 1; len--) {
          if (OPEN_TAG.startsWith(pending.slice(-len))) {
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
        const idx = pending.indexOf(CLOSE_TAG);
        if (idx !== -1) {
          const before = pending.slice(0, idx);
          if (before) onThink(before);
          pending = pending.slice(idx + CLOSE_TAG.length);
          inThink = false;
          continue;
        }

        // Проверяем, является ли суффикс pending префиксом </think>
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, CLOSE_TAG.length - 1);
        for (let len = maxCheck; len >= 1; len--) {
          if (CLOSE_TAG.startsWith(pending.slice(-len))) {
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
    }
  };
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
  const toolCallsMap = {};

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
          const idx = tc.index ?? 0;
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = {
              id: tc.id || '',
              type: tc.type || 'function',
              function: {
                name: tc.function?.name || '',
                arguments: ''
              }
            };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) {
            toolCallsMap[idx].function.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            toolCallsMap[idx].function.arguments += tc.function.arguments;
          }
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

  const toolCalls = Object.values(toolCallsMap);

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

/**
 * Получить список доступных моделей Google Gemini через OpenAI-совместимый эндпоинт
 *
 * @param {string} apiKey - API-ключ Google AI Studio
 * @returns {Promise<string[]>} Массив ID моделей Gemini, отсортированный по убыванию
 */
export async function listGoogleModels(apiKey) {
  if (!apiKey) {
    throw new Error('Ключ Google AI Studio не указан');
  }

  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Таймаут подключения к Google AI Studio (5с)');
    }
    throw new Error(`Ошибка сети Google AI Studio: ${err.message}`);
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error('Ключ Google AI Studio не подошёл');
    }
    throw new Error(`Google AI Studio вернул ошибку HTTP ${res.status}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Не удалось разобрать ответ Google AI Studio');
  }

  const rawList = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.models) ? json.models : []);
  const excluded = [
    'embedding',
    'image',
    'tts',
    'audio',
    'live',
    'aqa',
    'robotics',
    'omni',
    'banana',
    'transcribe',
    'computer-use',
    'customtools',
    'nano'
  ];

  const ids = [];
  for (const item of rawList) {
    const rawId = typeof item === 'string' ? item : item?.id;
    if (!rawId) continue;
    const cleanId = rawId.replace(/^models\//, '');
    const lower = cleanId.toLowerCase();
    if (!lower.includes('gemini')) continue;
    if (excluded.some(ex => lower.includes(ex))) continue;
    if (!ids.includes(cleanId)) {
      ids.push(cleanId);
    }
  }

  ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return ids;
}

