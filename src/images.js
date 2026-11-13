/**
 * @fileoverview Работа с изображениями: константы, форматирование, загрузка файлов и разметка
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Соответствие расширений файлов MIME-типам
 */
export const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 5;

/**
 * Форматирует размер в байтах в человекочитаемый вид (КБ / МБ).
 *
 * @param {number} bytes - Размер в байтах
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  }
  if (n >= 1024) {
    return `${Math.round(n / 1024)} КБ`;
  }
  return `${n} Б`;
}

/**
 * Загружает изображение с диска.
 *
 * @param {string} filePath - Путь к файлу
 * @returns {{ mime: string, data: Buffer }}
 */
export function loadImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    throw new Error(`Неподдерживаемый формат изображения: ${ext || 'без расширения'}`);
  }

  const data = fs.readFileSync(filePath);
  if (data.length > MAX_IMAGE_BYTES) {
    const sizeMb = (data.length / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`Файл ${path.basename(filePath)} (${sizeMb} МБ) превышает лимит ${limitMb} МБ`);
  }

  return { mime, data };
}

/**
 * Формирует поле content для сообщения пользователя.
 * Если список изображений пуст — возвращает строку text, иначе массив блоков с base64.
 *
 * @param {string} text - Текст сообщения
 * @param {Array<{ mime: string, data: Buffer }>} [images=[]] - Список изображений
 * @returns {string|Array<object>}
 */
export function buildUserContent(text, images) {
  if (!Array.isArray(images) || images.length === 0) {
    return text;
  }

  return [
    { type: 'text', text },
    ...images.map(img => {
      const base64 = Buffer.isBuffer(img.data)
        ? img.data.toString('base64')
        : Buffer.from(img.data || '').toString('base64');
      return {
        type: 'image_url',
        image_url: {
          url: `data:${img.mime};base64,${base64}`
        }
      };
    })
  ];
}

/**
 * Подпись вложения удаляется только целиком: если правка задела подпись, из текста
 * убирается вся подпись, иначе после Backspace остаётся обрывок «[Изображение #1».
 *
 * @param {string} prev - Текст до правки
 * @param {string} next - Текст после правки
 * @param {Array<string>} labels - Подписи текущих вложений
 * @returns {string} Текст после правки с учётом удаления подписей
 */
export function removeBrokenLabels(prev, next, labels) {
  if (next.length >= prev.length) return next;
  let from = 0;
  while (from < next.length && prev[from] === next[from]) from++;
  let to = prev.length;
  let nextEnd = next.length;
  while (nextEnd > from && prev[to - 1] === next[nextEnd - 1]) {
    to--;
    nextEnd--;
  }
  if (nextEnd !== from) return next;
  let touched = false;
  for (const label of labels) {
    const start = prev.indexOf(label);
    const end = start + label.length;
    if (start !== -1 && start < to && end > from) {
      from = Math.min(from, start);
      to = Math.max(to, end);
      touched = true;
    }
  }
  return touched ? prev.slice(0, from) + prev.slice(to) : next;
}
