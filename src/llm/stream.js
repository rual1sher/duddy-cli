/**
 * @fileoverview Стриминг ответов модели с таймаутами и обработкой рассуждений
 */

import { createClient } from './client.js';
import { createThinkFilter } from './thinkFilter.js';
import { createToolCallState } from './toolCalls.js';
import { parseRateHeaders } from '../models/limits.js';
import { ensureLocalModelInfo } from '../models/catalog.js';
import { getProvider } from '../providers.js';
import { buildRequestPayload, effortUnsupported } from './payload.js';
import {
  FIRST_CHUNK_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
  createTimeoutGuard
} from './timeoutGuard.js';
import { createDeltaHandler } from './deltaHandler.js';

/**
 * Открывает поток ответов модели с обработкой неподдерживаемых параметров
 *
 * @param {object} client - Клиент API
 * @param {object} payload - Полезная нагрузка запроса
 * @param {object} guard - Сторож таймаутов
 * @param {string} reasoningEffort - Уровень рассуждений
 * @param {Function} [onWarning] - Колбэк для предупреждений
 * @param {string} [provider] - Идентификатор провайдера (для запоминания отказа от уровня рассуждений)
 * @returns {Promise<{ stream: AsyncIterable<object>, rateLimits: object|null }>} Поток ответов модели и лимиты
 */
export async function openStream(client, payload, guard, reasoningEffort, onWarning, provider) {
  while (true) {
    try {
      const { data, response } = await client.chat.completions
        .create(payload, { signal: guard.signal })
        .withResponse();
      return {
        stream: data,
        rateLimits: parseRateHeaders(response?.headers)
      };
    } catch (err) {
      if (guard.timedOut) {
        throw err;
      }

      const msg = (err.message || '').toLowerCase();
      // Ollama: «"llama3.2:3b" does not support thinking»
      const hasReasoning = msg.includes('thinking') || msg.includes('reasoning');
      const hasEffortUnsupported =
        (hasReasoning && msg.includes('not supported')) ||
        ((err.status === 400 || err.statusCode === 400) && hasReasoning && msg.includes('support'));

      if ((payload.reasoning_effort || payload.reasoning) && hasEffortUnsupported) {
        const attemptedEffort = payload.reasoning_effort || payload.reasoning?.effort || reasoningEffort;
        delete payload.reasoning_effort;
        delete payload.reasoning;
        effortUnsupported.add(`${provider}:${payload.model}`);
        if (typeof onWarning === 'function') {
          onWarning(`Модель не поддерживает уровень рассуждений «${attemptedEffort}» — запрос без него.`);
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
 * Stream a chat completion with conciseness filters.
 *
 * @param {object} params
 * @param {string} [params.provider='openrouter']
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} [params.sessionId] - Идентификатор сессии для маршрутизации OpenRouter
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
 * @returns {Promise<{
 *   content: string,
 *   toolCalls: Array<object>|null,
 *   usage: object|null,
 *   routedModel: string,
 *   rateLimits: object|null
 * }>}
 */
export async function streamChatCompletion({
  provider = 'openrouter',
  apiKey,
  model,
  sessionId,
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

  if (getProvider(provider)?.local) {
    await ensureLocalModelInfo(model);
  }

  const client = createClient(apiKey, provider);
  const requestPayload = buildRequestPayload({
    model,
    messages,
    temperature,
    maxTokens,
    tools,
    reasoningEffort,
    provider,
    sessionId
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

  let streamResult = null;
  try {
    streamResult = await openStream(client, requestPayload, guard, reasoningEffort, onWarning, provider);
    const stream = streamResult.stream;

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
    routedModel: deltaHandler.routedModel,
    rateLimits: streamResult?.rateLimits ?? null
  };
}
