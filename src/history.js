/**
 * @fileoverview Управление историей сообщений сессии Duddy
 */

import { MAX_HISTORY_TURNS } from './agent.js';

export { MAX_HISTORY_TURNS };

/**
 * Фиксирует завершённый ход диалога в истории сессии:
 * - обрезает tool-результаты > 4000 символов из предыдущих ходов
 * - сохраняет сообщение пользователя и новые сообщения агента
 * - при пустом ответе сохраняет заглушку '(ход прерван: ответ не получен)'
 * - обрезает историю до MAX_HISTORY_TURNS ходов пользователя
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} userText - Текст запроса пользователя
 * @param {Array<object>} newMessages - Новые сообщения текущего хода
 * @param {string} [finalText] - Финальный текстовый ответ модели
 */
export function commitTurn(session, userText, newMessages, finalText) {
  session.messages = session.messages || [];

  // 1. Обрезаем tool-контент > 4000 из предыдущих ходов перед добавлением нового хода
  for (const msg of session.messages) {
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 4000) {
      msg.content = msg.content.slice(0, 4000) + '\n...[результат обрезан в истории]';
    }
  }

  // 2. Сохраняем ход: пользователь + новые сообщения
  session.messages.push({ role: 'user', content: userText });
  if (Array.isArray(newMessages)) {
    session.messages.push(...newMessages);
  }

  // 3. Заглушка при пустом ответе
  if (!finalText || !finalText.trim()) {
    session.messages.push({ role: 'assistant', content: '(ход прерван: ответ не получен)' });
  }

  // 4. Ограничиваем историю последними MAX_HISTORY_TURNS ходов пользователя
  const userIndices = [];
  for (let i = 0; i < session.messages.length; i++) {
    if (session.messages[i].role === 'user') {
      userIndices.push(i);
    }
  }
  if (userIndices.length > MAX_HISTORY_TURNS) {
    const cutoff = userIndices[userIndices.length - MAX_HISTORY_TURNS];
    session.messages = session.messages.slice(cutoff);
  }
}
