/** @fileoverview Инструменты поиска по проекту: grep (по содержимому) и glob (по именам файлов) */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { resolveSafePath } from './safePath.js';
import { classifyPath } from './sensitivePath.js';
import { scanSecrets } from './secretScan.js';

const RG_COMMON_ARGS = ['--no-config', '--no-require-git', '--sort', 'path'];
// Идёт последним: у rg приоритет за более поздним --glob, иначе glob от модели открыл бы .git
const RG_EXCLUDE_GIT = '--glob=!.git';
const TIMEOUT_MS = 15000;
const MAX_MATCHES = 100;
const MAX_FILES = 200;
const MAX_OUTPUT_CHARS = 12000;
const MAX_LINE_CHARS = 240;
const LIMIT_NOTE_RESERVE = 120;
const RG_NOT_FOUND_MSG = 'Ошибка: для поиска нужен ripgrep (rg), он не установлен. Установка: https://github.com/BurntSushi/ripgrep#installation';
const TIMEOUT_NOTE = '...[Поиск не завершён: превышен таймаут]...';

/**
 * Проверяет цель поиска: явный путь rg просматривает, даже если файл скрытый.
 *
 * @param {string} [targetPath] - Путь из запроса
 * @param {Function} log - Функция лога
 * @returns {Promise<{ relPath?: string, failure?: string }>}
 */
async function resolveSearchTarget(targetPath, log) {
  const { fullPath, relPath, realPath, error } = await resolveSafePath(targetPath || '.');
  if (error) {
    log('error', `✖ ${error}`);
    return { failure: error };
  }

  if (classifyPath(fullPath, realPath)) {
    const denied = `Ошибка: Доступ запрещён — "${relPath}" может содержать секреты, поиск по нему недоступен. Используй read_file, пользователь подтвердит доступ.`;
    log('error', `✖ ${denied}`);
    return { failure: denied };
  }
  return { relPath };
}

/**
 * Запускает rg. Ошибка запуска приходит событием, а не исключением.
 *
 * @param {string[]} args - Аргументы rg
 * @returns {{ lines: object, stop: Function, finished: Promise<{ code: number|null, error: Error|null, stderr: string, timedOut: boolean }> }}
 */
function startRg(args) {
  const child = spawn('rg', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, TIMEOUT_MS);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const finished = new Promise((resolve) => {
    const finish = (code, error) => {
      clearTimeout(timer);
      resolve({ code, error, stderr, timedOut });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stop = () => {
    child.kill();
    lines.close();
  };
  return { lines, stop, finished };
}

/**
 * Превращает сбой rg в сообщение для модели.
 *
 * @param {{ code: number|null, error: Error|null, stderr: string }} result - Итог запуска
 * @param {boolean} isEmpty - Результатов нет
 * @returns {string|null}
 */
function rgFailure({ code, error, stderr }, isEmpty) {
  if (error) {
    return error.code === 'ENOENT' ? RG_NOT_FOUND_MSG : `Ошибка: ${error.message}`;
  }
  if (code === 2 && isEmpty) {
    const firstLine = stderr.split(/\r?\n/).map(s => s.trim()).find(Boolean) || 'неизвестная ошибка';
    return `Ошибка: некорректный запрос: ${firstLine}`;
  }
  return null;
}

/**
 * Решает, можно ли показывать совпадения из файла. Проверяется файл целиком, а не строка:
 * строка base64 из тела приватного ключа сама по себе на секрет не похожа.
 * Если файл не удалось проверить, он считается секретным.
 *
 * @param {string} fileAbsPath - Абсолютный путь
 * @returns {Promise<boolean>}
 */
async function isSearchable(fileAbsPath) {
  try {
    const realPath = await fs.realpath(fileAbsPath);
    if (classifyPath(fileAbsPath, realPath)) return false;
    return scanSecrets(await fs.readFile(realPath, 'utf8')).length === 0;
  } catch {
    return false;
  }
}

/**
 * Ищет текст в файлах проекта через ripgrep.
 *
 * @param {object} args
 * @param {string} args.pattern - Регулярное выражение или текст
 * @param {string} [args.path] - Где искать
 * @param {string} [args.glob] - Фильтр файлов
 * @param {boolean} [args.case_insensitive] - Без учёта регистра
 * @param {boolean} [args.literal] - Искать как обычный текст
 * @param {object} ctx - Контекст инструмента
 * @param {Function} log - Функция лога
 * @returns {Promise<string>}
 */
export async function grepFiles(args, ctx, log) {
  if (args.pattern === undefined || args.pattern === null || String(args.pattern) === '') {
    return 'Ошибка: не указан pattern.';
  }

  const { relPath, failure } = await resolveSearchTarget(args.path, log);
  if (failure) {
    return failure;
  }

  const rgArgs = [...RG_COMMON_ARGS, '--json', '--max-count', '20', '--max-filesize', '2M'];
  // Модель обычно ищет слово строчными буквами, а в коде оно бывает внутри applyLoyaltyDiscount
  rgArgs.push(args.case_insensitive ? '-i' : '--smart-case');
  if (args.literal) rgArgs.push('-F');
  if (args.glob) rgArgs.push(`--glob=${args.glob}`);
  rgArgs.push(RG_EXCLUDE_GIT, '-e', String(args.pattern), '--', relPath);

  const { lines, stop, finished } = startRg(rgArgs);
  const results = [];
  const searchable = new Map();
  let outputChars = 0;
  let hitLimit = false;
  let hiddenFiles = 0;

  for await (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const filePath = event.data?.path?.text;
    const text = event.data?.lines?.text;
    if (event.type !== 'match' || typeof filePath !== 'string' || typeof text !== 'string') continue;

    const fileAbsPath = path.resolve(process.cwd(), filePath);
    if (!searchable.has(fileAbsPath)) {
      const allowed = await isSearchable(fileAbsPath);
      searchable.set(fileAbsPath, allowed);
      if (!allowed) hiddenFiles++;
    }
    if (!searchable.get(fileAbsPath)) continue;

    const trimmed = text.replace(/\r?\n$/, '');
    const shown = trimmed.length > MAX_LINE_CHARS ? `${trimmed.slice(0, MAX_LINE_CHARS)}…` : trimmed;
    const formatted = `${path.relative(process.cwd(), fileAbsPath)}:${event.data.line_number}: ${shown}`;

    if (outputChars + formatted.length + LIMIT_NOTE_RESERVE > MAX_OUTPUT_CHARS) {
      hitLimit = true;
      stop();
      break;
    }
    results.push(formatted);
    outputChars += formatted.length + 1;
    if (results.length >= MAX_MATCHES) {
      hitLimit = true;
      stop();
      break;
    }
  }

  const result = await finished;
  const failed = rgFailure(result, results.length === 0);
  if (failed) {
    return failed;
  }

  const notFound = `Совпадений нет: ${args.pattern}${args.glob ? ` (с фильтром ${args.glob}, шаблон src/*.js не заходит в подпапки, нужен src/**/*.js)` : ''}`;
  const output = results.length > 0 ? [...results] : [result.timedOut ? TIMEOUT_NOTE : notFound];
  if (hitLimit) {
    output.push(`...[Показаны первые ${results.length} совпадений. Уточни запрос: pattern, path или glob]...`);
  }
  if (hiddenFiles > 0) {
    output.push(`...[Скрыто файлов с секретами: ${hiddenFiles}. Чтобы увидеть их, используй read_file]...`);
  }
  if (result.timedOut && results.length > 0) {
    output.push(TIMEOUT_NOTE);
  }
  return output.join('\n');
}

/**
 * Ищет файлы по шаблону имени. Имена файлов не секрет: их показывает и list_dir.
 *
 * @param {object} args
 * @param {string} args.pattern - Шаблон, например "src/*.js"
 * @param {string} [args.path] - Где искать
 * @param {object} ctx - Контекст инструмента
 * @param {Function} log - Функция лога
 * @returns {Promise<string>}
 */
export async function globFiles(args, ctx, log) {
  if (args.pattern === undefined || args.pattern === null || String(args.pattern) === '') {
    return 'Ошибка: не указан pattern.';
  }

  const { relPath, failure } = await resolveSearchTarget(args.path, log);
  if (failure) {
    return failure;
  }

  const rgArgs = [...RG_COMMON_ARGS, '--files', `--glob=${args.pattern}`, RG_EXCLUDE_GIT, '--', relPath];
  const { lines, stop, finished } = startRg(rgArgs);
  const files = [];
  let hitLimit = false;

  for await (const line of lines) {
    if (!line) continue;

    const fileAbsPath = path.resolve(process.cwd(), line);
    const realPath = await fs.realpath(fileAbsPath).catch(() => fileAbsPath);
    if (classifyPath(fileAbsPath, realPath) === 'forbidden') continue;

    files.push(path.relative(process.cwd(), fileAbsPath));
    if (files.length >= MAX_FILES) {
      hitLimit = true;
      stop();
      break;
    }
  }

  const result = await finished;
  const failed = rgFailure(result, files.length === 0);
  if (failed) {
    return failed;
  }

  if (files.length === 0) {
    return result.timedOut ? TIMEOUT_NOTE : `Файлов нет: ${args.pattern}`;
  }

  const output = [`Найдено файлов: ${files.length}`, ...files];
  if (hitLimit) {
    output.push(`...[Показаны первые ${MAX_FILES}. Уточни pattern]...`);
  }
  if (result.timedOut) {
    output.push(TIMEOUT_NOTE);
  }
  return output.join('\n');
}
