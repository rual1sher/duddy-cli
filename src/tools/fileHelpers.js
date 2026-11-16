/**
 * @fileoverview Общие вспомогательные функции для файловых инструментов агента
 */

import crypto from 'node:crypto';
import { resolveSafePath, validateFilePath } from './safePath.js';
import { classifyPath } from './sensitivePath.js';

export const MAX_CHARS = 40000;
export const SENSITIVE_WARNING =
  'Файл может содержать секреты: с этим доступом модель и провайдер увидят его содержимое';

const BINARY_PROBE_BYTES = 8192;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const FILE_TOOLS = new Set(['create_file', 'read_file', 'edit_file', 'delete_file']);

/**
 * Проверяет безопасность путей и валидирует путь к файлу для файловых инструментов.
 *
 * @param {object} args - Аргументы инструмента
 * @param {string} toolName - Имя инструмента
 * @param {Function} log - Функция логирования
 * @param {object} [options] - Опции для resolveSafePath
 * @returns {Promise<{ fullPath?: string, relPath?: string, sensitive?: boolean, failure?: string }>}
 */
export async function resolveTarget(args, toolName, log, options) {
  if (FILE_TOOLS.has(toolName)) {
    const pathError = validateFilePath(args.path, toolName);
    if (pathError) {
      log('error', `✖ ${pathError}`);
      return { failure: pathError };
    }
  }

  const targetPath = toolName === 'list_dir' ? (args.path || '.') : args.path;
  const { fullPath, relPath, realPath, error } = await resolveSafePath(targetPath, options);
  if (error) {
    log('error', '✖ ' + error);
    return { failure: error };
  }

  const access = classifyPath(fullPath, realPath);
  if (access === 'forbidden') {
    const denied = `Ошибка: Доступ запрещён — "${relPath}" относится к настройкам duddy с API-ключами.`;
    log('error', `✖ ${denied}`);
    return { failure: denied };
  }

  return { fullPath, relPath, sensitive: access === 'sensitive' };
}

/**
 * Декодирует буфер как UTF-8 без замены повреждённых байтов.
 *
 * @param {Buffer} raw - Байты файла
 * @returns {string|null} Текст или null, если байты не являются валидным UTF-8
 */
export function decodeUtf8(raw) {
  try {
    return STRICT_UTF8.decode(raw);
  } catch {
    return null;
  }
}

/**
 * Проверяет наличие NUL-байта, аналогично git для определения бинарных файлов.
 *
 * @param {Buffer} raw - Байты файла
 * @returns {boolean} true, если файл бинарный
 */
export function isBinary(raw) {
  return raw.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/**
 * Вычисляет SHA-256 хеш содержимого файла для проверки полного чтения.
 *
 * @param {Buffer|string} data - Содержимое файла
 * @returns {string} Хеш в шестнадцатеричном формате
 */
export function contentHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Запоминает, что модель видела эту точную версию файла в текущем ходе.
 *
 * @param {object} ctx - Контекст исполнения инструментов
 * @param {string} fullPath - Абсолютный путь к файлу
 * @param {Buffer|string} data - Содержимое файла
 */
export function rememberFullRead(ctx, fullPath, data) {
  ctx.fullyRead ??= new Map();
  ctx.fullyRead.set(fullPath, contentHash(data));
}

/**
 * Возвращает причину, почему create_file не может заменить файл, который модель не прочитала целиком.
 *
 * @param {string} relPath - Относительный путь к файлу
 * @param {string|null} text - Текущий текст файла или null, если он не в UTF-8
 * @returns {string|null} Сообщение об ошибке или null, если перезапись разрешена
 */
export function overwriteBlockedReason(relPath, text) {
  if (text === null) {
    return (
      `Ошибка: ${relPath} не текст в UTF-8, create_file его не заменяет: содержимое было бы потеряно. ` +
      'Если замена нужна, сначала удали файл через delete_file.'
    );
  }
  if (text.length > MAX_CHARS) {
    return (
      `Ошибка: ${relPath} длиннее ${MAX_CHARS} символов, create_file его не заменяет: ` +
      'так легко потерять часть, которую модель не видела. Меняй файл через edit_file. ' +
      'Если нужна полная замена, сначала удали файл через delete_file.'
    );
  }
  return null;
}

/**
 * Сообщает, что файл изменился, пока было открыто окно подтверждения.
 *
 * @param {string} relPath - Относительный путь к файлу
 * @param {Function} log - Функция логирования
 * @returns {string} Сообщение об ошибке
 */
export function changedWhileWaiting(relPath, log) {
  const msg =
    `Ошибка: ${relPath} изменился, пока ждали подтверждения, запись отменена. ` +
    'Прочитай файл заново и повтори правку.';
  log('error', `✖ ${msg}`);
  return msg;
}
