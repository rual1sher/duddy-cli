/**
 * @fileoverview Инструмент чтения файлов (read_file) порциями и диапазонами строк
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { requestApproval } from './approval.js';
import { scanSecrets } from './secretScan.js';
import {
  resolveTarget,
  decodeUtf8,
  isBinary,
  contentHash,
  rememberFullRead,
  MAX_CHARS,
  SENSITIVE_WARNING
} from './fileHelpers.js';

const DEFAULT_LINE_COUNT = 200;

/**
 * Вырезает один фрагмент read_file с выравниванием по границе строки, если она есть.
 *
 * @param {string} content - Полный текст файла
 * @param {number} offset - Индекс первого символа
 * @param {number} [stop=content.length] - Индекс окончания запрашиваемой части
 * @returns {{ chunk: string, end: number }}
 */
function sliceChunk(content, offset, stop = content.length) {
  let end = offset + MAX_CHARS;
  if (end >= stop) {
    return { chunk: content.slice(offset, stop), end: stop };
  }

  const lineEnd = content.lastIndexOf('\n', end - 1) + 1;
  if (lineEnd > offset) {
    end = lineEnd;
  } else {
    const code = content.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return { chunk: content.slice(offset, end), end };
}

/**
 * Разбирает смещение offset для read_file (модели иногда передают числа строками).
 *
 * @param {unknown} value - Значение аргумента
 * @returns {number|null} Неотрицательное целое число или null при некорректном значении
 */
function parseOffset(value) {
  if (value === undefined || value === null || value === '') return 0;
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

/**
 * Разбирает параметры диапазона строк для read_file.
 *
 * @param {object} args - Аргументы инструмента
 * @returns {{ startLine: number, maxLines: number }|null|undefined}
 *   null если диапазон не задан, undefined если невалиден
 */
function parseLineRange(args) {
  const isSet = (value) => value !== undefined && value !== null && value !== '';
  if (!isSet(args.start_line) && !isSet(args.max_lines)) return null;

  const startLine = isSet(args.start_line) ? Number(args.start_line) : 1;
  const maxLines = isSet(args.max_lines) ? Number(args.max_lines) : DEFAULT_LINE_COUNT;
  if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(maxLines) || maxLines < 1) {
    return undefined;
  }
  return { startLine, maxLines };
}

/**
 * Формирует подсказку для модели о том, как продолжить чтение после диапазона строк.
 *
 * @param {string} chunk - Возвращённый текст
 * @param {number} end - Индекс после возвращённого текста
 * @param {{ startLine: number }} range - Запрошенный диапазон
 * @param {{ stop: number, totalLines: number }} window - Границы диапазона в символах
 * @returns {string} Текст примечания (пустая строка, если файл завершён)
 */
function lineRangeNote(chunk, end, range, window) {
  const reachedWindowEnd = end === window.stop;
  if (!reachedWindowEnd && !chunk.endsWith('\n')) {
    return `...[Строка длиннее лимита. Чтобы читать дальше, вызови read_file с offset=${end}]...`;
  }
  const newlines = chunk.split('\n').length - 1;
  const lastShown = range.startLine + newlines - (reachedWindowEnd ? 0 : 1);
  if (lastShown >= window.totalLines) return '';
  return (
    `...[Показаны строки ${range.startLine}–${lastShown} из ${window.totalLines}. ` +
    `Чтобы читать дальше, вызови read_file с start_line=${lastShown + 1}]...`
  );
}

/**
 * Определяет диапазон символов в тексте по номерам строк.
 *
 * @param {string} content - Полный текст файла
 * @param {{ startLine: number, maxLines: number }} range - Запрошенные строки
 * @returns {{ start: number, stop: number, totalLines: number }|null} null, если диапазон начинается за пределами файла
 */
function lineWindow(content, { startLine, maxLines }) {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lastWanted = startLine + maxLines - 1;
  let start = startLine === 1 ? 0 : -1;
  let stop = body.length;
  let line = 1;

  for (let i = body.indexOf('\n'); i !== -1; i = body.indexOf('\n', i + 1)) {
    if (line === lastWanted) {
      stop = i;
    }
    line++;
    if (line === startLine) {
      start = i + 1;
    }
  }

  if (start === -1 || (body.length === 0 && startLine > 1)) return null;
  return { start, stop, totalLines: line };
}

/**
 * Читает текстовый файл порциями до MAX_CHARS символов или по диапазону строк.
 *
 * @param {object} args - Аргументы вызова { path, offset, start_line, max_lines }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @param {object} [meta={}] - Метаданные вызова (заполняется свойство secret)
 * @returns {Promise<string>} Содержимое файла или сообщение об ошибке
 */
export async function readFile(args, ctx, log, meta = {}) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(args, 'read_file', log);
  if (failure) {
    return failure;
  }

  if (!fsSync.existsSync(fullPath)) {
    log('error', `✖ Файл не найден: ${relPath}`);
    return `Ошибка: Файл ${relPath} не найден.`;
  }

  const stats = await fs.stat(fullPath);
  if (stats.isDirectory()) {
    return `Ошибка: Путь ${relPath} является папкой, а не файлом. Используйте list_dir.`;
  }

  const offset = parseOffset(args.offset);
  if (offset === null) {
    return `Ошибка: offset должен быть целым неотрицательным числом (получено "${args.offset}").`;
  }

  const range = parseLineRange(args);
  if (range === undefined) {
    return 'Ошибка: start_line и max_lines должны быть целыми числами от 1.';
  }
  if (range && offset > 0) {
    return 'Ошибка: укажи либо offset, либо start_line.';
  }

  if (sensitive) {
    const preview = [{ kind: 'warn', text: SENSITIVE_WARNING }];
    const approval = await requestApproval('read_file', relPath, ctx, preview, { sensitive });
    if (!approval.approved) {
      return approval.message;
    }
  }

  log('info', `📖 Чтение файла: ${relPath}`);
  const raw = await fs.readFile(fullPath);
  if (isBinary(raw)) {
    return `Ошибка: ${relPath} — бинарный файл (${stats.size} байт), прочитать его как текст нельзя.`;
  }

  const strictText = decodeUtf8(raw);
  const content = strictText ?? raw.toString('utf8');
  if (offset > 0 && offset >= content.length) {
    return `Ошибка: offset ${offset} за концом файла ${relPath} (${content.length} символов).`;
  }

  const hash = contentHash(raw);
  const readKey = `${fullPath}#${offset}#${range?.startLine}#${range?.maxLines}`;
  if (ctx.fullyRead?.get(fullPath) === hash || ctx.seenReads?.get(readKey) === hash) {
    return `Файл ${relPath} уже прочитан в этом ходе и не менялся, результат есть выше. Повторное чтение не нужно.`;
  }

  const window = range ? lineWindow(content, range) : null;
  if (range && !window) {
    return `Ошибка: start_line ${range.startLine} за концом файла ${relPath}.`;
  }
  const start = window ? window.start : offset;

  // Limit huge files to prevent context blowout
  const { chunk, end } = sliceChunk(content, start, window?.stop);

  // Секрет определяется по содержимому порции: файл с обычным именем тоже мог его содержать
  const findings = sensitive ? [] : scanSecrets(chunk);
  if (findings.length > 0) {
    const firstLine = content.slice(0, start).split('\n').length - 1;
    const preview = [
      { kind: 'warn', text: SENSITIVE_WARNING },
      ...findings.map(f => ({ kind: 'warn', text: `Похоже на секрет: ${f.label}, строка ${firstLine + f.line}` }))
    ];
    const approval = await requestApproval('read_file', relPath, ctx, preview, { sensitive: true });
    if (!approval.approved) {
      return approval.message;
    }
  }
  meta.secret = sensitive || findings.length > 0;
  meta.fullPath = fullPath;
  meta.readKey = readKey;

  let note = '';
  if (window) {
    note = lineRangeNote(chunk, end, range, window);
  } else if (end < content.length) {
    note =
      `...[Обрезано: показаны символы ${offset}–${end} из ${content.length}. ` +
      `Чтобы читать дальше, вызови read_file с offset=${end}]...`;
  }

  ctx.seenReads ??= new Map();
  ctx.seenReads.set(readKey, hash);
  if (start === 0 && !note && strictText !== null) {
    rememberFullRead(ctx, fullPath, raw);
  }

  let result = chunk;
  if (note) {
    result += `\n\n${note}`;
  }
  if (strictText === null) {
    result +=
      '\n\n...[Внимание: файл не в UTF-8, символы могут быть искажены, ' +
      'edit_file и create_file его не изменят]...';
  }
  return result;
}
