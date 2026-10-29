/**
 * @fileoverview Управление историей сообщений сессии Duddy
 */

import { MAX_HISTORY_TURNS } from './agent.js';

export const MAX_IMAGE_TURNS = 3;
export { MAX_HISTORY_TURNS };

/**
 * Фиксирует завершённый ход диалога в истории сессии:
 * - обрезает tool-результаты > 4000 символов из предыдущих ходов
 * - заменяет устаревшие изображения в истории на текстовые заглушки
 * - сохраняет сообщение пользователя и новые сообщения агента
 * - при пустом ответе сохраняет заглушку '(ход прерван: ответ не получен)'
 * - обрезает историю до MAX_HISTORY_TURNS ходов пользователя
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string|Array<object>} userText - Текст или массив частей запроса пользователя
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

  // 2. Очищаем старые base64-изображения из истории, чтобы не раздувать контекст
  const userMessages = session.messages.filter(m => m.role === 'user');
  const keepCount = MAX_IMAGE_TURNS - 1;
  const toStripCount = Math.max(0, userMessages.length - keepCount);
  for (let i = 0; i < toStripCount; i++) {
    const msg = userMessages[i];
    if (Array.isArray(msg.content)) {
      msg.content = msg.content.map(part =>
        part?.type === 'image_url'
          ? { type: 'text', text: '[изображение удалено из истории]' }
          : part
      );
    }
  }

  // 3. Сохраняем ход: пользователь + новые сообщения
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
