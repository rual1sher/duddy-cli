/**
 * @fileoverview Подготовка текста для синтеза речи (очистка markdown, кода, URL)
 */

/**
 * Очищает текст от markdown разметки, блоков кода и спецсимволов для естественного чтения вслух.
 * @param {string} text
 * @returns {string}
 */
export function cleanTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Убираем блоки кода с тройными обратными кавычками (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' [блок кода пропущен] ');

  // Убираем инлайн код `код`
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Убираем markdown ссылки: [текст ссылки](http://...) -> текст ссылки
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Убираем голые URL
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');

  // Убираем markdown заголовки (# Заголовок)
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // Убираем списки (*, -, 1.)
  cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
  cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

  // Убираем жирный/курсивный шрифт (**жирный**, *курсив*)
  cleaned = cleaned.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');

  // Убираем зачеркивание (~текст~)
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // Убираем цитаты (> цитата)
  cleaned = cleaned.replace(/^>\s+/gm, '');

  // Убираем ANSI цвета, если затесались
  cleaned = cleaned.replace(/\u001b\[\d+m/g, '');

  // Убираем множественные переносы строк и лишние пробелы
  cleaned = cleaned.replace(/\n+/g, '. ').replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}
