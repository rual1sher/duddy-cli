/**
 * @fileoverview Обработка дельт потокового ответа модели (текст, вызовы инструментов, рассуждения)
 */

import { accumulateToolCallDelta } from './toolCalls.js';

/**
 * Создает обработчик дельт потокового ответа модели
 *
 * @param {object} params - Параметры обработчика дельт
 * @param {object} params.state - Состояние накопления вызовов инструментов
 * @param {object} params.thinkFilter - Потоковый фильтр рассуждений
 * @param {(model: string) => void} [params.onModel] - Колбэк при получении имени модели
 * @param {(think: string) => void} [params.onReasoning] - Колбэк рассуждений
 * @param {() => boolean} params.hasResponse - Проверка наличия уже полученного текстового ответа
 * @returns {object} Объект с методами обработки чанков и состоянием
 */
export function createDeltaHandler({
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
      routedModel = chunk.model;
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

    // Forward reasoning tokens (DeepSeek R1, Nemotron, etc.; присылают мысли в reasoning_content)
    const reasoning = delta.reasoning || delta.reasoning_content;
    if (reasoning) {
      if (typeof onReasoning === 'function') {
        onReasoning(reasoning);
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
