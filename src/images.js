/**
 * @fileoverview Работа с изображениями: буфер обмена, пути к файлам и кодирование в data URL
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

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

const SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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
 * Читает изображение из буфера обмена операционной системы (Wayland или X11).
 *
 * @returns {Promise<{ mime: string, data: Buffer }|null>}
 */
export async function readClipboardImage() {
  const isWayland = Boolean(process.env.WAYLAND_DISPLAY);
  const missingToolMessage = 'Для вставки картинок установите wl-clipboard (Wayland) или xclip (X11)';

  let targetsRaw = '';
  try {
    if (isWayland) {
      const res = await execFileAsync('wl-paste', ['--list-types'], {
        timeout: 3000,
        maxBuffer: 1024 * 1024
      });
      targetsRaw = String(res.stdout || '');
    } else {
      const res = await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], {
        timeout: 3000,
        maxBuffer: 1024 * 1024
      });
      targetsRaw = String(res.stdout || '');
    }
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      throw new Error(missingToolMessage);
    }
    return null;
  }

  const targetLines = targetsRaw.split(/\r?\n/).map(line => line.trim().toLowerCase());
  const chosenMime = SUPPORTED_MIMES.find(mime =>
    targetLines.some(line => line === mime || line.startsWith(`${mime};`))
  );

  if (!chosenMime) {
    return null;
  }

  let data;
  try {
    const res = isWayland
      ? await execFileAsync('wl-paste', ['--type', chosenMime], {
          timeout: 3000,
          maxBuffer: 20 * 1024 * 1024,
          encoding: 'buffer'
        })
      : await execFileAsync('xclip', ['-selection', 'clipboard', '-t', chosenMime, '-o'], {
          timeout: 3000,
          maxBuffer: 20 * 1024 * 1024,
          encoding: 'buffer'
        });
    data = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      throw new Error(missingToolMessage);
    }
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const limitMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(`Размер изображения превышает лимит ${limitMb} МБ`);
    }
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > MAX_IMAGE_BYTES) {
    const sizeMb = (data.length / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`Размер изображения (${sizeMb} МБ) превышает лимит ${limitMb} МБ`);
  }

  return { mime: chosenMime, data };
}

/**
 * Разбивает строку на токены с поддержкой кавычек и экранированных пробелов.
 *
 * @param {string} rawText
 * @returns {string[]|null}
 */
function extractPathTokens(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return null;
  }

  const tokens = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let hasToken = false;

  for (let i = 0; i < rawText.length; i++) {
    const char = rawText[i];

    if (escaped) {
      current += char;
      escaped = false;
      hasToken = true;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      hasToken = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      hasToken = true;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (inSingleQuote || inDoubleQuote || escaped) {
    return null;
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : null;
}

/**
 * Проверяет, состоит ли переданный текст целиком из путей к существующим файлам-картинкам.
 *
 * @param {string} text - Вставленный текст
 * @returns {string[]|null} Массив абсолютных путей к файлам или null
 */
export function parseImagePaths(text) {
  const tokens = extractPathTokens(text);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const absolutePaths = [];

  for (const token of tokens) {
    let clean = token;

    if (clean.startsWith('file://')) {
      try {
        const parsed = new URL(clean);
        clean = decodeURIComponent(parsed.pathname);
      } catch {
        clean = decodeURIComponent(clean.replace(/^file:\/\/(localhost)?/, ''));
      }
    }

    if (clean === '~' || clean.startsWith('~/')) {
      clean = path.join(os.homedir(), clean.slice(1));
    }

    const resolved = path.resolve(clean);
    const ext = path.extname(resolved).toLowerCase();

    if (!IMAGE_MIME[ext]) {
      return null;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return null;
      }
    } catch {
      return null;
    }

    absolutePaths.push(resolved);
  }

  return absolutePaths;
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
