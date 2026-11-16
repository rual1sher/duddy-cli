/**
 * @fileoverview Инструменты файловой системы (create_folder, delete_file, delete_folder, list_dir)
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { requestApproval } from './approval.js';
import { resolveTarget } from './fileHelpers.js';

/**
 * Создаёт директорию (включая промежуточные папки).
 *
 * @param {object} args - Аргументы вызова { path }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Сообщение о результате операции
 */
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

/**
 * Удаляет файл или символическую ссылку без разыменования.
 *
 * @param {object} args - Аргументы вызова { path }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Сообщение о результате операции
 */
export async function deleteFile(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(
    args,
    'delete_file',
    log,
    { followFinalSymlink: false }
  );
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

  await fs.unlink(fullPath);
  log('success', `✔ Файл удален: ${relPath}`);
  return `✓ Файл ${relPath} успешно удален.`;
}

/**
 * Удаляет директорию рекурсивно со всем содержимым (запрещено для корня и симлинков).
 *
 * @param {object} args - Аргументы вызова { path }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Сообщение о результате операции
 */
export async function deleteFolder(args, ctx, log) {
  const { fullPath, relPath, sensitive, failure } = await resolveTarget(
    args,
    'delete_folder',
    log,
    { followFinalSymlink: false }
  );
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

  await fs.rm(fullPath, { recursive: true, force: true });
  log('success', `✔ Папка удалена: ${relPath}`);
  return `✓ Папка ${relPath} со всем содержимым успешно удалена.`;
}

/**
 * Возвращает список элементов директории с иконками папок и файлов.
 *
 * @param {object} args - Аргументы вызова { path }
 * @param {object} ctx - Контекст исполнения
 * @param {Function} log - Функция логирования
 * @returns {Promise<string>} Текстовый список элементов
 */
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
