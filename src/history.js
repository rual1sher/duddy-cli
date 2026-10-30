/**
 * @fileoverview Управление историей сообщений сессии Duddy
 */

import { MAX_HISTORY_TURNS } from './agent.js';

export const MAX_IMAGE_TURNS = 3;
export { MAX_HISTORY_TURNS };

/**
 * Обрезает длинные результаты вызовов инструментов (> 4000 символов)
 *
 * @param {Array<object>} messages - Массив сообщений
 */
function trimToolResults(messages) {
  for (const msg of messages) {
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 4000) {
      msg.content = msg.content.slice(0, 4000) + '\n...[результат обрезан в истории]';
    }
  }
}

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
  trimToolResults(session.messages);

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

/**
 * Сохраняет в истории ход и при ошибке, и при отмене, чтобы его можно было продолжить.
 * Запрос, отклонённый провайдером (4xx, кроме 408 и 429) до завершения хотя бы одного шага,
 * не сохраняется: он сломал бы и все следующие запросы (например, неподдерживаемое изображение).
 * При 4xx обрезает tool-результаты в истории и в partial, так как частая причина — переполнение контекста.
 * Если последний шаг partial содержит текстовый ответ (answered), заглушка не добавляется.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string|Array<object>} userContent - Текст или массив частей запроса пользователя
 * @param {Error & { status?: number, statusCode?: number, partialMessages?: Array<object> }} err - Ошибка хода
 * @returns {boolean} true, если ход сохранён
 */
export function commitFailedTurn(session, userContent, err) {
  const partial = err?.partialMessages || [];
  const status = Number(err?.status || err?.statusCode || 0);
  const rejected = status >= 400 && status < 500 && status !== 408 && status !== 429;
  if (rejected) {
    // Частая причина отказа — переполненный контекст: без обрезки упадёт и следующий запрос
    trimToolResults(session.messages || []);
    trimToolResults(partial);
    if (partial.length === 0) return false;
  }
  const last = partial[partial.length - 1];
  const answered = last?.role === 'assistant' && !last.tool_calls && last.content;
  commitTurn(session, userContent, partial, answered ? last.content : '');
  return true;
}
