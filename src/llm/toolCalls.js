/** @fileoverview Накопление и сборка потоковых вызовов инструментов */

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
