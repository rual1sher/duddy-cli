/**
 * @fileoverview Формирование полезной нагрузки (payload) запросов к API моделей
 */

import { findModel } from '../models/catalog.js';
import { getProvider } from '../providers.js';

// Модели, отказавшиеся от уровня рассуждений в этой сессии: ключ «провайдер:модель».
// Следующие запросы идут без него, без лишнего запроса и повторного предупреждения.
export const effortUnsupported = new Set();

/**
 * Формирует полезную нагрузку запроса к API модели
 *
 * @param {object} params - Параметры запроса
 * @param {string} params.model - Идентификатор модели
 * @param {Array<object>} params.messages - Массив сообщений
 * @param {number} [params.temperature] - Температура генерации
 * @param {number} [params.maxTokens] - Максимальное количество токенов
 * @param {Array<object>} [params.tools] - Список инструментов
 * @param {string} [params.reasoningEffort] - Уровень рассуждений
 * @param {string} [params.provider] - Идентификатор провайдера
 * @param {string} [params.sessionId] - Идентификатор сессии
 * @param {boolean} [params.stream=true] - Потоковый режим
 * @returns {object} Объект параметров запроса к API
 */
export function buildRequestPayload({
  model,
  messages,
  temperature,
  maxTokens,
  tools,
  reasoningEffort,
  provider,
  sessionId,
  stream = true
}) {
  const requestPayload = {
    model: model,
    messages: messages,
    temperature: temperature,
    stream: stream
  };
  if (stream) {
    requestPayload.stream_options = { include_usage: true };
  }
  if (maxTokens) {
    requestPayload.max_tokens = maxTokens;
  }
  if (tools && tools.length > 0) {
    requestPayload.tools = tools;
  }
  if (provider === 'openrouter') {
    // Остальные провайдеры кэшируют сами, Claude только по явной просьбе
    if (/^~?anthropic\//.test(model)) {
      requestPayload.cache_control = { type: 'ephemeral' };
    }
    // Держит запросы одной сессии на одном провайдере, иначе кэш не срабатывает
    if (sessionId) {
      requestPayload.session_id = sessionId;
    }
  }
  const isLocal = Boolean(getProvider(provider)?.local);
  const modelThinking = findModel(model)?.thinking;
  const unsupported = effortUnsupported.has(`${provider}:${model}`);

  if (isLocal) {
    if (!unsupported) {
      const isAutoOrEmpty = !reasoningEffort || reasoningEffort === 'auto';
      if (isAutoOrEmpty) {
        if (modelThinking === true) {
          requestPayload.reasoning_effort = 'none';
        }
      } else if (modelThinking !== false) {
        requestPayload.reasoning_effort = reasoningEffort;
      }
    }
  } else {
    const noThinking = (modelThinking === false) || unsupported;
    if (reasoningEffort && reasoningEffort !== 'auto' && !noThinking) {
      if (provider === 'openrouter') {
        requestPayload.reasoning = { effort: reasoningEffort };
      } else {
        requestPayload.reasoning_effort = reasoningEffort;
      }
    }
  }
  return requestPayload;
}
