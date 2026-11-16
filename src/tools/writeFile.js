/**
 * @fileoverview Инструменты создания и редактирования файлов (create_file, edit_file)
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fuzzyReplace } from './fuzzyReplace.js';
import { requestApproval } from './approval.js';
import {
  resolveTarget,
  decodeUtf8,
  contentHash,
  rememberFullRead,
  overwriteBlockedReason,
  changedWhileWaiting,
  SENSITIVE_WARNING
} from './fileHelpers.js';

const PREVIEW_LINES = 12;

/**
 * Добавляет до PREVIEW_LINES строк в превью подтверждения.
 *
 * @param {Array<object>} preview - Массив превью для пополнения
 * @param {string[]} lines - Строки для отображения
 * @param {'add'|'del'} kind - Тип строки (добавление или удаление)
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
 * Формирует дифф-превью для диалога подтверждения edit_file.
 *
 * @param {string} oldContent - Исходный текст для замены
 * @param {string} newContent - Новый текст замены
 * @returns {Array<{ kind: string, text: string }>}
 */
function buildEditPreview(oldContent, newContent) {
  const preview = [];
  pushPreviewLines(preview, oldContent.split('\n'), 'del');
  pushPreviewLines(preview, newContent.split('\n'), 'add');
  return preview;
}

/**
 * Формирует превью перезаписи create_file: блок изменений между
 * общими начальными и конечными строками двух версий.
 *
 * @param {string} relPath - Относительный путь к файлу
 * @param {string} oldText - Текущий текст файла
 * @param {string} newText - Новый текст файла
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
 * Создаёт новый файл или перезаписывает существующий с запросом подтверждения.
 *
 * @param {object} args - Аргументы вызова { path, content }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Сообщение о результате операции
 */
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
      return (
        `Ошибка: Путь "${relPath}" является директорией, а не файлом. ` +
        `Укажите полное имя создаваемого файла, например "${relPath}/index.html".`
      );
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
      const msg =
        `Ошибка: перед перезаписью прочитай ${relPath} целиком через read_file ` +
        'в этом же ходе: файл не читался или изменился после чтения. ' +
        'Для небольших правок используй edit_file.';
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

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  rememberFullRead(ctx, fullPath, content);
  log('success', `✔ Файл сохранен: ${relPath} (${content.length} байт)`);
  return exists
    ? `✓ Файл ${relPath} перезаписан (${content.length} байт).`
    : `✓ Файл ${relPath} создан (${content.length} байт).`;
}

/**
 * Выполняет точечную замену фрагмента текста в файле с запросом подтверждения.
 *
 * @param {object} args - Аргументы вызова { path, old_content, new_content }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Сообщение о результате операции
 */
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
    return (
      'Ошибка: Параметр old_content пуст. ' +
      `Для полной перезаписи файла используйте create_file(path: "${relPath}", content: "...").`
    );
  }

  const originalRaw = await fs.readFile(fullPath);
  const original = decodeUtf8(originalRaw);
  if (original === null) {
    const msg =
      `Ошибка: ${relPath} не в UTF-8: ` +
      'запись через edit_file испортила бы символы, которые не удалось прочитать.';
    log('error', `✖ ${msg}`);
    return msg;
  }

  const replaceResult = fuzzyReplace(original, oldContent, newContent);

  if (!replaceResult.success) {
    if (replaceResult.reason === 'ambiguous') {
      const msg =
        `Ошибка: фрагмент old_content встречается в ${relPath} ${replaceResult.count} раз(а). ` +
        'Добавь в old_content больше соседних строк, чтобы совпадение было единственным.';
      log('error', `✖ ${msg}`);
      return msg;
    }
    log('error', `✖ Фрагмент для замены не найден в ${relPath}`);
    return [
      `Ошибка: Указанный old_content не найден в файле ${relPath}.`,
      'Подсказки для исправления:',
      '1. Если вы хотите полностью перезаписать файл новым содержимым — ' +
        `вызовите инструмент create_file(path: "${relPath}", content: "...").`,
      '2. Для частичной замены сначала вызовите read_file, ' +
        'скопируйте точный непрерывный фрагмент строк из файла (включая отступы).'
    ].join('\n');
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

  await fs.writeFile(fullPath, replaceResult.content, 'utf8');
  if (ctx.fullyRead?.has(fullPath)) {
    rememberFullRead(ctx, fullPath, replaceResult.content);
  }
  log('success', `✔ Файл обновлен: ${relPath}`);
  return `✓ Файл ${relPath} успешно изменен.`;
}
