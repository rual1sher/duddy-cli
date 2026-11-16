/**
 * @fileoverview Учёт расхода токенов за ход и сессию
 */

/**
 * Учитывает токены из ответа модели: обновляет session.lastUsage, накапливает turnUsage,
 * session.totalTokens и статистику по текущей модели в session.modelUsage.
 *
 * @param {object} session - Объект сессии
 * @param {object} usage - Данные об использовании токенов от провайдера
 * @param {{ input: number, output: number, cached: number }} turnUsage - Счётчик токенов за ход
 */
export function recordUsage(session, usage, turnUsage) {
  if (!usage) return;
  if (session) {
    session.lastUsage = usage;
  }
  if (turnUsage) {
    turnUsage.input += usage.prompt_tokens || 0;
    turnUsage.output += usage.completion_tokens || 0;
    turnUsage.cached += usage.prompt_tokens_details?.cached_tokens || 0;
  }
  const total = usage.total_tokens || 0;
  if (session) {
    session.totalTokens = (session.totalTokens || 0) + total;
    if (!session.modelUsage) {
      session.modelUsage = {};
    }
    if (!session.modelUsage[session.model]) {
      session.modelUsage[session.model] = { lastTokens: 0, totalTokens: 0 };
    }
    session.modelUsage[session.model].lastTokens = total;
    session.modelUsage[session.model].totalTokens += total;
  }
}
