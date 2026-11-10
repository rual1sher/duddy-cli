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

  // Убираем жирный/курсивный шрифт (***x***, **x**, *x*, __x__, _x_)
  cleaned = cleaned.replace(/(?<=^|[\s\p{P}])\*{3}([^\s*](?:[\s\S]*?[^\s*])?)\*{3}(?=$|[^\p{L}\p{N}_])/gu, '$1');
  cleaned = cleaned.replace(/(?<=^|[\s\p{P}])\*{2}([^\s*](?:[\s\S]*?[^\s*])?)\*{2}(?=$|[^\p{L}\p{N}_])/gu, '$1');
  cleaned = cleaned.replace(/(?<=^|[\s\p{P}])\*([^\s*](?:[\s\S]*?[^\s*])?)\*(?=$|[^\p{L}\p{N}_])/gu, '$1');
  cleaned = cleaned.replace(/(?<=^|[\s\p{P}])_{2}([^\s_](?:[\s\S]*?[^\s_])?)_{2}(?=$|[^\p{L}\p{N}_])/gu, '$1');
  cleaned = cleaned.replace(/(?<=^|[\s\p{P}])_([^\s_](?:[\s\S]*?[^\s_])?)_(?=$|[^\p{L}\p{N}_])/gu, '$1');

  // Убираем зачеркивание (~текст~)
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // Убираем цитаты (> цитата)
  cleaned = cleaned.replace(/^>\s+/gm, '');

  // Убираем ANSI цвета, если затесались
  cleaned = cleaned.replace(/\u001b\[[0-9;]*m/g, '');

  // Убираем множественные переносы строк и лишние пробелы
  cleaned = cleaned.replace(/\n+/g, '. ').replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}
