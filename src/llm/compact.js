/** @fileoverview Сжатие старых результатов инструментов внутри контекста модели */

export const TOOL_RESULT_BUDGET = 60000;
// Убираем с запасом: сжатие меняет начало запроса и сбрасывает кэш провайдера, поэтому оно должно быть редким
export const TOOL_RESULT_TARGET = 30000;
const MIN_COMPACT_CHARS = 500;

/**
 * Находит цель вызова по его id, чтобы заглушка говорила, какой файл был убран.
 *
 * @param {Array<object>} messages - Сообщения запроса
 * @returns {Map<string, string>} id вызова -> путь или шаблон поиска
 */
function collectCallTargets(messages) {
  const targets = new Map();
  for (const msg of messages) {
    for (const call of msg.tool_calls || []) {
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        targets.set(call.id, args.path || args.pattern || '');
      } catch {
        // Невалидные аргументы не мешают сжатию
      }
    }
  }
  return targets;
}

/**
 * Каждый шаг заново отправляет всё накопленное, поэтому расход растёт квадратично.
 * Когда результатов инструментов становится больше бюджета, самые старые заменяются заглушкой.
 * Результаты последнего шага не трогаем: модель ещё не успела их использовать.
 * Массив меняется на месте, сами объекты сообщений остаются нетронутыми, потому что они же лежат в истории.
 *
 * @param {Array<object>} messages - Сообщения запроса
 * @returns {string[]} id вызовов, результаты которых убраны
 */
export function compactToolResults(messages) {
  let total = 0;
  let lastStep = 0;
  messages.forEach((msg, i) => {
    if (msg.role === 'tool' && typeof msg.content === 'string') total += msg.content.length;
    if (msg.role === 'assistant' && msg.tool_calls) lastStep = i;
  });
  if (total <= TOOL_RESULT_BUDGET) return [];

  const targets = collectCallTargets(messages);
  const removed = [];
  for (let i = 0; i < lastStep && total > TOOL_RESULT_TARGET; i++) {
    const msg = messages[i];
    if (msg.role !== 'tool' || typeof msg.content !== 'string' || msg.content.length < MIN_COMPACT_CHARS) continue;

    const content = `[Результат ${msg.name} (${targets.get(msg.tool_call_id) ?? ''}) убран из контекста для экономии. Если он снова нужен, вызови инструмент ещё раз и возьми только нужные строки.]`;
    total -= msg.content.length - content.length;
    messages[i] = { ...msg, content };
    removed.push(msg.tool_call_id);
  }
  return removed;
}
