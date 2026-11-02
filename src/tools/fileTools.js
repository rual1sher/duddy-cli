/** @fileoverview Реализация файловых инструментов агента */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveSafePath, validateFilePath } from './safePath.js';
import { fuzzyReplace } from './fuzzyReplace.js';
import { requestApproval } from './approval.js';
import { classifyPath } from './sensitivePath.js';
import { scanSecrets } from './secretScan.js';

const MAX_CHARS = 40000;
const DEFAULT_LINE_COUNT = 200;
const PREVIEW_LINES = 12;
const BINARY_PROBE_BYTES = 8192;
const SENSITIVE_WARNING = 'Файл может содержать секреты: с этим доступом модель и провайдер увидят его содержимое';
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const FILE_TOOLS = new Set(['create_file', 'read_file', 'edit_file', 'delete_file']);

/**
 * Resolves safe paths and validates file path for file tools.
 *
 * @param {object} args - Tool arguments
 * @param {string} toolName - Name of the tool
 * @param {Function} log - Logger function
 * @param {object} [options] - Options for resolveSafePath
 * @returns {Promise<{ fullPath?: string, relPath?: string, sensitive?: boolean, failure?: string }>}
 */
async function resolveTarget(args, toolName, log, options) {
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
 * Decodes a buffer as UTF-8 without replacing broken bytes.
 *
 * @param {Buffer} raw - File bytes
 * @returns {string|null} Text, or null if the bytes are not valid UTF-8
 */
function decodeUtf8(raw) {
  try {
    return STRICT_UTF8.decode(raw);
  } catch {
    return null;
  }
}

/**
 * Checks for a NUL byte, the way git tells binary files from text.
 *
 * @param {Buffer} raw - File bytes
 * @returns {boolean}
 */
function isBinary(raw) {
  return raw.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/**
 * Hashes file bytes for the fully-read check.
 *
 * @param {Buffer|string} data - File content
 * @returns {string}
 */
function contentHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Remembers that the model has seen this exact version of the file in the current turn.
 *
 * @param {object} ctx - Tool execution context
 * @param {string} fullPath - Absolute file path
 * @param {Buffer|string} data - File content
 */
function rememberFullRead(ctx, fullPath, data) {
  ctx.fullyRead ??= new Map();
  ctx.fullyRead.set(fullPath, contentHash(data));
}

/**
 * Cuts one read_file chunk, on a line boundary when the chunk contains one.
 *
 * @param {string} content - Full file text
 * @param {number} offset - Index of the first character
 * @param {number} [stop=content.length] - Index where the requested part ends
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
 * Parses the read_file offset; models sometimes send numbers as strings.
 *
 * @param {unknown} value - Raw tool argument
 * @returns {number|null} Non-negative integer, or null if invalid
 */
function parseOffset(value) {
  if (value === undefined || value === null || value === '') return 0;
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

/**
 * Parses the read_file line range.
 *
 * @param {object} args - Tool arguments
 * @returns {{ startLine: number, maxLines: number }|null|undefined} null if no range was asked for, undefined if invalid
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
 * Tells the model how to continue reading after a line range.
 *
 * @param {string} chunk - Returned text
 * @param {number} end - Index after the returned text
 * @param {{ startLine: number }} range - Requested range
 * @param {{ stop: number, totalLines: number }} window - Character window of the range
 * @returns {string} Note, empty if the file ended
 */
function lineRangeNote(chunk, end, range, window) {
  const reachedWindowEnd = end === window.stop;
  if (!reachedWindowEnd && !chunk.endsWith('\n')) {
    return `...[Строка длиннее лимита. Чтобы читать дальше, вызови read_file с offset=${end}]...`;
  }
  const newlines = chunk.split('\n').length - 1;
  const lastShown = range.startLine + newlines - (reachedWindowEnd ? 0 : 1);
  if (lastShown >= window.totalLines) return '';
  return `...[Показаны строки ${range.startLine}–${lastShown} из ${window.totalLines}. Чтобы читать дальше, вызови read_file с start_line=${lastShown + 1}]...`;
}

/**
 * Finds the character window of a line range.
 *
 * @param {string} content - Full file text
 * @param {{ startLine: number, maxLines: number }} range - Requested lines
 * @returns {{ start: number, stop: number, totalLines: number }|null} null if the range starts past the end
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
 * Adds up to PREVIEW_LINES lines to the confirmation preview.
 *
 * @param {Array<object>} preview - Preview to extend
 * @param {string[]} lines - Lines to show
 * @param {'add'|'del'} kind - Line kind
 */
function pushPreviewLines(preview, lines, kind) {
  for (const line of lines.slice(0, PREVIEW_LINES)) {
    preview.push({ kind, text: line });
  }
  if (lines.length > PREVIEW_LINES) {
    preview.push({ kind: 'info', text: `… ещё ${lines.length - PREVIEW_LINES} строк` });
  }
}

/**
 * Builds diff preview for edit_file confirmation dialog.
 *
 * @param {string} oldContent - Original text to replace
 * @param {string} newContent - Replacement text
 * @returns {Array<{ kind: string, text: string }>}
 */
function buildEditPreview(oldContent, newContent) {
  const preview = [];
  pushPreviewLines(preview, oldContent.split('\n'), 'del');
  pushPreviewLines(preview, newContent.split('\n'), 'add');
  return preview;
}

/**
 * Builds the preview of a create_file overwrite: the changed block between
 * the common first and last lines of the two versions.
 *
 * @param {string} relPath - Relative file path
 * @param {string} oldText - Current file text
 * @param {string} newText - New file text
 * @returns {Array<{ kind: string, text: string }>}
 */
function buildOverwritePreview(relPath, oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const preview = [{
    kind: 'warn',
    text: `Файл: ${relPath} (ПЕРЕЗАПИСЬ существующего файла: было ${oldLines.length} строк, станет ${newLines.length})`
  }];
  if (oldText === newText) {
    preview.push({ kind: 'info', text: 'Содержимое не меняется' });
    return preview;
  }
  pushPreviewLines(preview, oldLines.slice(start, oldEnd), 'del');
  pushPreviewLines(preview, newLines.slice(start, newEnd), 'add');
  return preview;
}

/**
 * Explains why create_file must not replace a file the model cannot have read in full.
 *
 * @param {string} relPath - Relative file path
 * @param {string|null} text - Current file text, or null if it is not valid UTF-8
 * @returns {string|null} Error message, or null if overwriting is allowed
 */
function overwriteBlockedReason(relPath, text) {
  if (text === null) {
    return `Ошибка: ${relPath} не текст в UTF-8, create_file его не заменяет: содержимое было бы потеряно. Если замена нужна, сначала удали файл через delete_file.`;
  }
  if (text.length > MAX_CHARS) {
    return `Ошибка: ${relPath} длиннее ${MAX_CHARS} символов, create_file его не заменяет: так легко потерять часть, которую модель не видела. Меняй файл через edit_file. Если нужна полная замена, сначала удали файл через delete_file.`;
  }
  return null;
}

/**
 * Reports that the file changed while the confirmation dialog was open.
 *
 * @param {string} relPath - Relative file path
 * @param {Function} log - Logger function
 * @returns {string} Error message
 */
function changedWhileWaiting(relPath, log) {
  const msg = `Ошибка: ${relPath} изменился, пока ждали подтверждения, запись отменена. Прочитай файл заново и повтори правку.`;
  log('error', `✖ ${msg}`);
  return msg;
}

export async function createFile(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(args, 'create_file', log);
  if (failure) {
    return failure;
  }

  const content = args.content ?? '';
  const exists = fsSync.existsSync(fullPath);

  if (exists) {
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      log('error', `✖ Ошибка: "${relPath}" является папкой, а не файлом.`);
      return `Ошибка: Путь "${relPath}" является директорией, а не файлом. Укажите полное имя создаваемого файла, например "${relPath}/index.html".`;
    }
  }

  const originalRaw = exists ? await fs.readFile(fullPath) : null;
  let preview;
  if (exists) {
    const originalText = decodeUtf8(originalRaw);
    const blocked = overwriteBlockedReason(relPath, originalText);
    if (blocked) {
      log('error', `✖ ${blocked}`);
      return blocked;
    }
    if (originalRaw.length > 0 && ctx.fullyRead?.get(fullPath) !== contentHash(originalRaw)) {
      const msg = `Ошибка: перед перезаписью прочитай ${relPath} целиком через read_file в этом же ходе: файл не читался или изменился после чтения. Для небольших правок используй edit_file.`;
      log('error', `✖ ${msg}`);
      return msg;
    }
    preview = buildOverwritePreview(relPath, originalText, content);
  } else {
    preview = [{ kind: 'info', text: `Файл: ${relPath} (новый файл, ${content.length} байт)` }];
    pushPreviewLines(preview, content.split('\n'), 'add');
  }
  if (sensitive) {
    preview.unshift({ kind: 'warn', text: SENSITIVE_WARNING });
  }

  const approval = await requestApproval('create_file', relPath, ctx, preview, { sensitive });
  if (!approval.approved) {
    return approval.message;
  }

  const current = await fs.readFile(fullPath).catch(() => null);
  if (exists ? !current?.equals(originalRaw) : current !== null) {
    return changedWhileWaiting(relPath, log);
  }

  await ctx.checkpoint?.snapshot(fullPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  await ctx.checkpoint?.markWritten(fullPath);
  rememberFullRead(ctx, fullPath, content);
  log('success', `✔ Файл сохранен: ${relPath} (${content.length} байт)`);
  return exists
    ? `✓ Файл ${relPath} перезаписан (${content.length} байт).`
    : `✓ Файл ${relPath} создан (${content.length} байт).`;
}

export async function createFolder(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'create_folder', log);
  if (failure) {
    return failure;
  }

  const exists = fsSync.existsSync(fullPath);

  if (exists) {
    log('info', `ℹ Папка ${relPath} уже существует.`);
    return `✓ Папка ${relPath} уже существует.`;
  }

  await fs.mkdir(fullPath, { recursive: true });
  log('success', `✔ Папка создана: ${relPath}`);
  return `✓ Папка ${relPath} успешно создана.`;
}

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
    const approval = await requestApproval('read_file', relPath, ctx, [{ kind: 'warn', text: SENSITIVE_WARNING }], { sensitive });
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

  const note = window
    ? lineRangeNote(chunk, end, range, window)
    : (end < content.length ? `...[Обрезано: показаны символы ${offset}–${end} из ${content.length}. Чтобы читать дальше, вызови read_file с offset=${end}]...` : '');

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
    result += `\n\n...[Внимание: файл не в UTF-8, символы могут быть искажены, edit_file и create_file его не изменят]...`;
  }
  return result;
}

export async function editFile(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(args, 'edit_file', log);
  if (failure) {
    return failure;
  }

  if (!fsSync.existsSync(fullPath)) {
    log('error', `✖ Файл не найден: ${relPath}`);
    return `Ошибка: Файл ${relPath} не существует. Чтобы создать его, используйте create_file.`;
  }

  const stats = await fs.stat(fullPath);
  if (stats.isDirectory()) {
    return `Ошибка: Путь "${relPath}" является директорией, а не файлом.`;
  }

  const oldContent = args.old_content ?? '';
  const newContent = args.new_content ?? '';

  if (!oldContent.trim()) {
    log('error', `✖ Параметр old_content пуст в ${relPath}`);
    return `Ошибка: Параметр old_content пуст. Для полной перезаписи файла используйте create_file(path: "${relPath}", content: "...").`;
  }

  const originalRaw = await fs.readFile(fullPath);
  const original = decodeUtf8(originalRaw);
  if (original === null) {
    const msg = `Ошибка: ${relPath} не в UTF-8: запись через edit_file испортила бы символы, которые не удалось прочитать.`;
    log('error', `✖ ${msg}`);
    return msg;
  }

  const replaceResult = fuzzyReplace(original, oldContent, newContent);

  if (!replaceResult.success) {
    if (replaceResult.reason === 'ambiguous') {
      const msg = `Ошибка: фрагмент old_content встречается в ${relPath} ${replaceResult.count} раз(а). Добавь в old_content больше соседних строк, чтобы совпадение было единственным.`;
      log('error', `✖ ${msg}`);
      return msg;
    }
    log('error', `✖ Фрагмент для замены не найден в ${relPath}`);
    return `Ошибка: Указанный old_content не найден в файле ${relPath}.
Подсказки для исправления:
1. Если вы хотите полностью перезаписать файл новым содержимым — вызовите инструмент create_file(path: "${relPath}", content: "...").
2. Для частичной замены сначала вызовите read_file, скопируйте точный непрерывный фрагмент строк из файла (включая отступы).`;
  }

  const preview = buildEditPreview(oldContent, newContent);
  if (sensitive) {
    preview.unshift({ kind: 'warn', text: SENSITIVE_WARNING });
  }

  const approval = await requestApproval('edit_file', relPath, ctx, preview, { sensitive });
  if (!approval.approved) {
    return approval.message;
  }

  const current = await fs.readFile(fullPath).catch(() => null);
  if (!current?.equals(originalRaw)) {
    return changedWhileWaiting(relPath, log);
  }

  await ctx.checkpoint?.snapshot(fullPath);
  await fs.writeFile(fullPath, replaceResult.content, 'utf8');
  await ctx.checkpoint?.markWritten(fullPath);
  if (ctx.fullyRead?.has(fullPath)) {
    rememberFullRead(ctx, fullPath, replaceResult.content);
  }
  log('success', `✔ Файл обновлен: ${relPath}`);
  return `✓ Файл ${relPath} успешно изменен.`;
}

export async function deleteFile(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(args, 'delete_file', log, { followFinalSymlink: false });
  if (failure) {
    return failure;
  }

  let stats;
  try {
    stats = await fs.lstat(fullPath);
  } catch (e) {
    log('error', `✖ Файл не найден: ${relPath}`);
    return `Ошибка: Файл ${relPath} не существует.`;
  }

  if (stats.isDirectory()) {
    log('error', `✖ Ошибка: Путь "${relPath}" является папкой.`);
    return `Ошибка: Путь "${relPath}" является папкой. Для удаления папок используйте delete_folder.`;
  }

  const preview = [{ kind: 'del', text: relPath }];

  const approval = await requestApproval('delete_file', relPath, ctx, preview, { sensitive });
  if (!approval.approved) {
    return approval.message;
  }

  if (ctx.checkpoint) {
    await ctx.checkpoint.moveToBackup(fullPath);
  } else {
    await fs.unlink(fullPath);
  }
  log('success', `✔ Файл удален: ${relPath}`);
  return `✓ Файл ${relPath} успешно удален.`;
}

export async function deleteFolder(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(args, 'delete_folder', log, { followFinalSymlink: false });
  if (failure) {
    return failure;
  }

  if (relPath === '.') {
    log('error', `✖ Ошибка: Нельзя удалить корневую рабочую папку.`);
    return `Ошибка: Нельзя удалить корневую рабочую папку.`;
  }

  let lstats;
  try {
    lstats = await fs.lstat(fullPath);
  } catch (e) {
    log('error', `✖ Папка не найдена: ${relPath}`);
    return `Ошибка: Папка ${relPath} не существует.`;
  }

  if (lstats.isSymbolicLink()) {
    const errMsg = `Ошибка: Путь "${relPath}" является символической ссылкой, удалите её через delete_file.`;
    log('error', `✖ ${errMsg}`);
    return errMsg;
  }

  if (!lstats.isDirectory()) {
    log('error', `✖ Ошибка: Путь "${relPath}" является файлом.`);
    return `Ошибка: Путь "${relPath}" является файлом. Для удаления файлов используйте delete_file.`;
  }

  const entries = await fs.readdir(fullPath).catch(() => []);
  const preview = [{ kind: 'del', text: `${relPath} (${entries.length} элементов верхнего уровня)` }];

  const approval = await requestApproval('delete_folder', relPath, ctx, preview, { sensitive });
  if (!approval.approved) {
    return approval.message;
  }

  if (ctx.checkpoint) {
    await ctx.checkpoint.moveToBackup(fullPath);
  } else {
    await fs.rm(fullPath, { recursive: true, force: true });
  }
  log('success', `✔ Папка удалена: ${relPath}`);
  return `✓ Папка ${relPath} со всем содержимым успешно удалена.`;
}

export async function listDir(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'list_dir', log);
  if (failure) {
    return failure;
  }

  if (!fsSync.existsSync(fullPath)) {
    log('error', `✖ Директория не найдена: ${relPath}`);
    return `Ошибка: Директория ${relPath} не найдена.`;
  }

  log('info', `📂 Просмотр папки: ${relPath}`);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const items = entries.map(e => `  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
  return `Содержимое папки ${relPath} (${entries.length} элементов):\n${items}`;
}
