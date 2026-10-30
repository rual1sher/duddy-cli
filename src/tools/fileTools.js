/** @fileoverview Реализация файловых инструментов агента */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { resolveSafePath, validateFilePath } from './safePath.js';
import { fuzzyReplace } from './fuzzyReplace.js';
import { requestApproval } from './approval.js';

const MAX_CHARS = 40000;
const FILE_TOOLS = new Set(['create_file', 'read_file', 'edit_file', 'delete_file']);

/**
 * Resolves safe paths and validates file path for file tools.
 *
 * @param {object} args - Tool arguments
 * @param {string} toolName - Name of the tool
 * @param {Function} log - Logger function
 * @param {object} [options] - Options for resolveSafePath
 * @returns {Promise<{ fullPath?: string, relPath?: string, failure?: string }>}
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
  const { fullPath, relPath, error } = await resolveSafePath(targetPath, options);
  if (error) {
    log('error', '✖ ' + error);
    return { failure: error };
  }

  return { fullPath, relPath };
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
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const previewOld = oldLines.slice(0, 12);
  for (const line of previewOld) {
    preview.push({ kind: 'del', text: line });
  }
  if (oldLines.length > 12) {
    preview.push({ kind: 'info', text: `… ещё ${oldLines.length - 12} строк` });
  }
  const previewNew = newLines.slice(0, 12);
  for (const line of previewNew) {
    preview.push({ kind: 'add', text: line });
  }
  if (newLines.length > 12) {
    preview.push({ kind: 'info', text: `… ещё ${newLines.length - 12} строк` });
  }
  return preview;
}

export async function createFile(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'create_file', log);
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

  const statusText = exists ? 'ПЕРЕЗАПИСЬ существующего файла' : 'новый файл';
  const preview = [{
    kind: exists ? 'warn' : 'info',
    text: `Файл: ${relPath} (${statusText}, ${content.length} байт)`
  }];

  const approval = await requestApproval('create_file', relPath, ctx, preview);
  if (!approval.approved) {
    return approval.message;
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
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

export async function readFile(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'read_file', log);
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

  log('info', `📖 Чтение файла: ${relPath}`);
  let content = await fs.readFile(fullPath, 'utf8');

  // Limit huge files to prevent context blowout
  if (content.length > MAX_CHARS) {
    content = content.slice(0, MAX_CHARS) + `\n\n...[Обрезано: файл слишком большой (${stats.size} байт)]...`;
  }

  return content;
}

export async function editFile(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'edit_file', log);
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

  const original = await fs.readFile(fullPath, 'utf8');
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

  const approval = await requestApproval('edit_file', relPath, ctx, preview);
  if (!approval.approved) {
    return approval.message;
  }

  await fs.writeFile(fullPath, replaceResult.content, 'utf8');
  log('success', `✔ Файл обновлен: ${relPath}`);
  return `✓ Файл ${relPath} успешно изменен.`;
}

export async function deleteFile(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'delete_file', log, { followFinalSymlink: false });
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

  const approval = await requestApproval('delete_file', relPath, ctx, preview);
  if (!approval.approved) {
    return approval.message;
  }

  await fs.unlink(fullPath);
  log('success', `✔ Файл удален: ${relPath}`);
  return `✓ Файл ${relPath} успешно удален.`;
}

export async function deleteFolder(args, ctx, log) {
  const { fullPath, relPath, failure } = await resolveTarget(args, 'delete_folder', log, { followFinalSymlink: false });
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

  const approval = await requestApproval('delete_folder', relPath, ctx, preview);
  if (!approval.approved) {
    return approval.message;
  }

  await fs.rm(fullPath, { recursive: true, force: true });
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
