/** @fileoverview Стриминг ответов модели с таймаутами и обработкой рассуждений */

import { createClient } from './client.js';
import { createThinkFilter } from './thinkFilter.js';
import { createToolCallState, accumulateToolCallDelta } from './toolCalls.js';

// Модель может молчать, пока думает или собирает большой вызов инструмента, поэтому лимит большой, а прервать можно вручную
export const FIRST_CHUNK_TIMEOUT_MS = 600000;
// Gemini отдаёт вызов инструмента одним чанком, поэтому после текста тишина бывает такой же долгой, как перед первым чанком
export const STREAM_STALL_TIMEOUT_MS = FIRST_CHUNK_TIMEOUT_MS;

/**
 * Формирует полезную нагрузку запроса к API модели
 *
 * @param {object} params - Параметры запроса
 * @returns {object} Объект параметров запроса
 */
function buildRequestPayload({
  model,
  messages,
  temperature,
  maxTokens,
  tools,
  reasoningEffort,
  provider
}) {
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
  return requestPayload;
}

/**
 * Создает сторож таймаутов стрима, таймер перезапускается на каждом чанке
 *
 * @param {object} params - Параметры сторожа таймаутов
 * @returns {object} Объект управления таймаутами
 */
function createTimeoutGuard({ signal, firstChunkTimeoutMs, stallTimeoutMs }) {
  const internalController = new AbortController();
  let timedOut = false;
  let receivedChunk = false;

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

  let timer = null;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const armTimer = (ms) => {
    clearTimer();
    timer = setTimeout(() => {
      timedOut = true;
      internalController.abort();
    }, ms);
  };

  armTimer(firstChunkTimeoutMs);

  return {
    signal: internalController.signal,
    get timedOut() {
      return timedOut;
    },
    get receivedChunk() {
      return receivedChunk;
    },
    onChunk() {
      receivedChunk = true;
      armTimer(stallTimeoutMs);
    },
    dispose() {
      clearTimer();
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    },
    toError(model) {
      if (!timedOut) return null;
      if (receivedChunk) {
        const timeoutErr = new Error(`Ответ модели ${model} оборвался: нет новых чанков ${Math.round(stallTimeoutMs / 1000)} с`);
        timeoutErr.code = 'STREAM_STALL_TIMEOUT';
        return timeoutErr;
      }
      const timeoutErr = new Error(`Модель ${model} не прислала ни одного чанка за ${Math.round(firstChunkTimeoutMs / 1000)} с — возможно, она ещё думала над ответом или запрос завис`);
      timeoutErr.code = 'FIRST_CHUNK_TIMEOUT';
      return timeoutErr;
    }
  };
}

/**
 * Открывает поток ответов модели с обработкой неподдерживаемых параметров
 *
 * @param {object} client - Клиент API
 * @param {object} payload - Полезная нагрузка запроса
 * @param {object} guard - Сторож таймаутов
 * @param {string} reasoningEffort - Уровень рассуждений
 * @param {Function} [onWarning] - Колбэк для предупреждений
 * @returns {Promise<object>} Поток ответов модели
 */
async function openStream(client, payload, guard, reasoningEffort, onWarning) {
  while (true) {
    try {
      return await client.chat.completions.create(payload, { signal: guard.signal });
    } catch (err) {
      if (guard.timedOut) {
        throw err;
      }

      const msg = (err.message || '').toLowerCase();
      const hasReasoning = msg.includes('thinking level') || msg.includes('reasoning');
      const hasEffortUnsupported = (hasReasoning && msg.includes('not supported')) ||
        ((err.status === 400 || err.statusCode === 400) && hasReasoning && msg.includes('support'));

      if ((payload.reasoning_effort || payload.reasoning) && hasEffortUnsupported) {
        delete payload.reasoning_effort;
        delete payload.reasoning;
        if (typeof onWarning === 'function') {
          onWarning(`Модель не поддерживает уровень рассуждений «${reasoningEffort}» — запрос без него.`);
        }
        continue;
      }

      const hasToolOrFunc = msg.includes('tool') || msg.includes('function');
      const hasToolSupport = msg.includes('support');

      if (payload.tools && hasToolOrFunc && hasToolSupport) {
        delete payload.tools;
        if (typeof onWarning === 'function') {
          onWarning('Модель не поддерживает инструменты — ответ без доступа к файлам.');
        }
        continue;
      }

      throw err;
    }
  }
}

/**
 * Создает обработчик дельт потокового ответа модели
 *
 * @param {object} params - Параметры обработчика дельт
 * @returns {object} Объект с методами обработки чанков и состоянием
 */
function createDeltaHandler({
  state,
  thinkFilter,
  onModel,
  onReasoning,
  hasResponse
}) {
  let routedModel = '';
  let modelReported = false;
  let usage = null;
  let inThinkingProcess = false;
  let thinkingProcessBuffer = '';

  function handleChunk(chunk) {
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
    if (!delta) return;

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
      if (!hasResponse() && !thinkingProcessBuffer && /Here\x27s a thinking process:/i.test(content)) {
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
          return;
        }
      }

      if (content) {
        thinkFilter.push(content);
      }
    }
  }

  function flushPendingThinking() {
    if (inThinkingProcess && thinkingProcessBuffer) {
      inThinkingProcess = false;
      thinkFilter.push(thinkingProcessBuffer);
      thinkingProcessBuffer = '';
    }
  }

  return {
    handleChunk,
    flushPendingThinking,
    get usage() {
      return usage;
    },
    get routedModel() {
      return routedModel;
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
 * @param {number} [params.firstChunkTimeoutMs=600000]
 * @param {number} [params.stallTimeoutMs=600000]
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
  firstChunkTimeoutMs = FIRST_CHUNK_TIMEOUT_MS,
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
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
  const requestPayload = buildRequestPayload({
    model,
    messages,
    temperature,
    maxTokens,
    tools,
    reasoningEffort,
    provider
  });

  const guard = createTimeoutGuard({ signal, firstChunkTimeoutMs, stallTimeoutMs });

  let fullResponse = '';
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

  const deltaHandler = createDeltaHandler({
    state,
    thinkFilter,
    onModel,
    onReasoning,
    hasResponse: () => Boolean(fullResponse)
  });

  try {
    const stream = await openStream(client, requestPayload, guard, reasoningEffort, onWarning);

    for await (const chunk of stream) {
      guard.onChunk();
      deltaHandler.handleChunk(chunk);
    }

    // The openai SDK ends the stream quietly on abort instead of throwing,
    // which would pass a cancelled or timed-out reply off as a finished one
    if (guard.signal.aborted) {
      const abortErr = new Error('Request was aborted.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  } catch (err) {
    const timeoutErr = guard.toError(model);
    if (timeoutErr) {
      throw timeoutErr;
    }
    if (guard.signal.aborted) {
      const abortErr = new Error('Request was aborted.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    throw err;
  } finally {
    guard.dispose();
  }

  deltaHandler.flushPendingThinking();
  thinkFilter.end();

  const toolCalls = state.calls;

  return {
    content: fullResponse,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage: deltaHandler.usage,
    routedModel: deltaHandler.routedModel
  };
}
