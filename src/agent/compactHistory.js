/**
 * @fileoverview Сжатие истории диалога в пересказ при заполнении окна контекста модели
 */

import { streamWithRetry } from '../llm/retry.js';
import { streamChatCompletion } from '../llm/stream.js';

export const COMPACT_THRESHOLD = 0.8;
export const KEEP_RECENT_TURNS = 2;
// Текст для пересказа должен занимать не больше ~60–75% окна, чтобы осталось место под ответ
export const SUMMARY_INPUT_CHARS_PER_TOKEN = 1.5;

export const SUMMARY_PROMPT =
  'Сжать историю диалога пользователя с ассистентом-агентом для продолжения работы.\n' +
  'Сохранить:\n' +
  '- цели и просьбы пользователя;\n' +
  '- принятые решения;\n' +
  '- какие файлы созданы, изменены или удалены и что в них сделано;\n' +
  '- команды и их важные результаты;\n' +
  '- ошибки и как их решили;\n' +
  '- что осталось сделать.\n' +
  'Без вступлений и оценок, маркированным списком, не длиннее 1500 слов.';

/**
 * Проверяет, требуется ли сжатие истории диалога из-за заполнения окна контекста.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {boolean} true, если окно контекста заполнено на 80% и более
 */
export function needsCompaction(session) {
  const total = session?.lastUsage?.total_tokens;
  const contextLength = session?.contextLength;
  if (typeof total !== 'number' || typeof contextLength !== 'number' || contextLength <= 0) {
    return false;
  }
  return total >= contextLength * COMPACT_THRESHOLD;
}

/**
 * Разделяет сообщения истории на старую часть для сжатия и недавние ходы,
 * сохраняемые дословно. Граница всегда проходит по сообщению пользователя,
 * поэтому пары assistant.tool_calls ↔ tool не разрываются.
 *
 * @param {Array<object>} messages - Массив сообщений истории
 * @param {number} [keepTurns=KEEP_RECENT_TURNS] - Число последних ходов пользователя
 * @returns {{ old: Array<object>, recent: Array<object> }}
 */
export function splitHistory(messages, keepTurns = KEEP_RECENT_TURNS) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { old: [], recent: [] };
  }
  const userIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      userIndices.push(i);
    }
  }
  if (userIndices.length <= keepTurns) {
    return { old: [], recent: [...messages] };
  }
  const cutoff = userIndices[userIndices.length - keepTurns];
  return {
    old: messages.slice(0, cutoff),
    recent: messages.slice(cutoff)
  };
}

/**
 * Извлекает текстовое содержимое сообщения (склеивает части, заменяет изображения).
 *
 * @param {string|Array<object>} content - Содержимое сообщения
 * @returns {string}
 */
function formatContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'image_url') return '[изображение]';
      return '';
    }).join('');
  }
  return '';
}

/**
 * Превращает массив сообщений истории в форматированный текст для модели пересказа.
 *
 * @param {Array<object>} messages - Массив сообщений
 * @param {number} [maxChars] - Максимальная длина текста
 * @returns {string}
 */
export function historyToText(messages, maxChars) {
  if (!Array.isArray(messages)) return '';
  const lines = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === 'user') {
      lines.push(`Пользователь: ${formatContent(msg.content)}`);
    } else if (msg.role === 'assistant') {
      if (msg.content) {
        lines.push(`Duddy: ${formatContent(msg.content)}`);
      }
      for (const call of msg.tool_calls || []) {
        const name = call.function?.name || 'tool';
        const rawArgs = call.function?.arguments || '';
        const args = rawArgs.length > 300 ? rawArgs.slice(0, 300) : rawArgs;
        lines.push(`Вызов инструмента ${name}: ${args}`);
      }
    } else if (msg.role === 'tool') {
      const name = msg.name || 'tool';
      const rawContent = formatContent(msg.content);
      const content = rawContent.length > 1500 ? rawContent.slice(0, 1500) : rawContent;
      lines.push(`Результат ${name}: ${content}`);
    }
  }
  let text = lines.join('\n');
  if (typeof maxChars === 'number' && maxChars > 0 && text.length > maxChars) {
    text = '[начало истории обрезано]\n' + text.slice(text.length - maxChars);
  }
  return text;
}

/**
 * Выполняет сжатие старой части истории диалога в пересказ через вызов модели.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Сигнал отмены
 * @param {Function} [options.onRequest] - Колбэк перед HTTP-запросом
 * @returns {Promise<{ compacted: boolean, removed?: number }>}
 */
export async function compactHistory(session, { signal, onRequest } = {}) {
  const { old, recent } = splitHistory(session.messages || []);
  if (old.length === 0) {
    return { compacted: false };
  }

  const maxChars = Math.max(8000, Math.floor((session.contextLength || 32000) * SUMMARY_INPUT_CHARS_PER_TOKEN));
  const res = await streamWithRetry(
    () => streamChatCompletion({
      provider: session.provider,
      apiKey: session.apiKey,
      model: session.model,
      sessionId: session.id,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: historyToText(old, maxChars) }
      ],
      temperature: 0.2,
      reasoningEffort: session.reasoningEffort,
      signal,
      onRequest
    }),
    {
      signal,
      canRetry: () => true
    }
  );

  const summary = (res?.content || '').trim();
  if (!summary) {
    throw new Error('Модель вернула пустой пересказ истории');
  }

  session.messages = [
    { role: 'user', content: '[Сжатая история предыдущего диалога]\n\n' + summary },
    { role: 'assistant', content: 'Понял, продолжаю с учётом этой истории.' },
    ...recent
  ];
  session.lastUsage = null;

  return { compacted: true, removed: old.length };
}

/**
 * Запасной вариант при сбое сжатия: удаляет старые сообщения, сохраняя последние 2 хода.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {number} Число удалённых сообщений
 */
export function dropOldHistory(session) {
  const { old, recent } = splitHistory(session.messages || []);
  session.messages = recent;
  session.lastUsage = null;
  return old.length;
}
