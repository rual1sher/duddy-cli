/** @fileoverview Чекпоинты изменений файлов агента для команды /undo */

import fsP from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const MAX_CHECKPOINTS = 20;
const CHECKPOINT_NAME = /^\d+-\d+$/;

/**
 * Возвращает корневой каталог чекпоинтов. Вычисляется при каждом вызове, а не при импорте.
 *
 * @returns {string}
 */
function checkpointsRoot() {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'duddy', 'checkpoints');
}

/**
 * Вычисляет sha256 файла.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function sha256File(filePath) {
  const data = await fsP.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Проверяет наличие пути, битая символическая ссылка тоже считается существующей.
 *
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function pathExists(target) {
  return fsP.lstat(target).then(() => true, () => false);
}

/**
 * Удаляет старейшие чекпоинты, оставляя не более MAX_CHECKPOINTS.
 *
 * @param {string} root - Корневой каталог чекпоинтов
 */
async function pruneOldCheckpoints(root) {
  const entries = await fsP.readdir(root).catch(() => []);
  const sorted = entries.filter(e => CHECKPOINT_NAME.test(e)).sort();
  const toDelete = sorted.slice(0, Math.max(0, sorted.length - MAX_CHECKPOINTS));
  for (const name of toDelete) {
    await fsP.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Атомарно сохраняет manifest.json в каталоге чекпоинта.
 *
 * @param {string} cpDir - Каталог чекпоинта
 * @param {object} manifest - Объект манифеста
 */
async function saveManifest(cpDir, manifest) {
  const target = path.join(cpDir, 'manifest.json');
  const tmp = `${target}.tmp-${process.pid}`;
  await fsP.writeFile(tmp, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fsP.rename(tmp, target);
}

/**
 * Переносит файл или папку, в том числе на другое устройство.
 *
 * @param {string} src
 * @param {string} dst
 */
async function movePath(src, dst) {
  try {
    await fsP.rename(src, dst);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsP.cp(src, dst, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    await fsP.rm(src, { recursive: true, force: true });
  }
}

/**
 * Создаёт чекпоинт для одного хода агента. На диск ничего не пишет до первого изменения.
 *
 * @param {string} cwd - Рабочая директория (realpath)
 * @returns {{ snapshot: Function, markWritten: Function, moveToBackup: Function }}
 */
export function createCheckpoint(cwd) {
  const id = `${Date.now()}-${process.pid}`;
  let cpDir = null;
  let seq = 0;
  const manifest = { id, cwd, createdAt: new Date().toISOString(), entries: [] };
  // Записи snapshot по fullPath: после удаления пути запись выбывает, новая запись пойдёт отдельно
  const snapshots = new Map();

  async function ensureDir() {
    if (cpDir !== null) return cpDir;
    const root = checkpointsRoot();
    const dir = path.join(root, id);
    await fsP.mkdir(path.join(dir, 'files'), { recursive: true, mode: 0o700 });
    await fsP.chmod(dir, 0o700);
    await pruneOldCheckpoints(root);
    cpDir = dir;
    return cpDir;
  }

  return {
    /**
     * Сохраняет копию файла перед его изменением. Ошибка копирования прерывает запись,
     * иначе откат считал бы существующий файл новым и удалил его.
     *
     * @param {string} fullPath - Абсолютный путь к файлу
     */
    async snapshot(fullPath) {
      if (snapshots.has(fullPath)) return;
      const dir = await ensureDir();

      const backup = `files/${seq++}`;
      const dst = path.join(dir, backup);
      let existed = true;
      try {
        await fsP.copyFile(fullPath, dst);
        await fsP.chmod(dst, 0o600);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        existed = false;
      }

      const entry = { path: fullPath, existed, backup: existed ? backup : null };
      manifest.entries.push(entry);
      snapshots.set(fullPath, entry);
      await saveManifest(dir, manifest);
    },

    /**
     * Запоминает sha256 файла после записи. Сбой здесь не отменяет уже сделанную запись,
     * запись без after откатится без проверки на изменения.
     *
     * @param {string} fullPath - Абсолютный путь к файлу
     */
    async markWritten(fullPath) {
      const entry = snapshots.get(fullPath);
      if (!entry) return;
      try {
        entry.after = await sha256File(fullPath);
        await saveManifest(cpDir, manifest);
      } catch {
        delete entry.after;
      }
    },

    /**
     * Переносит файл или папку в резервную копию вместо удаления.
     *
     * @param {string} fullPath - Абсолютный путь
     */
    async moveToBackup(fullPath) {
      const dir = await ensureDir();
      const backup = `files/${seq++}`;
      await movePath(fullPath, path.join(dir, backup));

      manifest.entries.push({ path: fullPath, existed: true, backup, after: null });
      for (const key of snapshots.keys()) {
        if (key === fullPath || key.startsWith(fullPath + path.sep)) {
          snapshots.delete(key);
        }
      }
      await saveManifest(dir, manifest);
    }
  };
}

/**
 * Ищет самый новый неотменённый чекпоинт папки.
 *
 * @param {string} root - Корневой каталог чекпоинтов
 * @param {string} cwd - Рабочая директория (realpath)
 * @returns {Promise<{ cpDir: string, manifest: object }|null>}
 */
async function findLastCheckpoint(root, cwd) {
  const names = await fsP.readdir(root).catch(() => []);
  const sorted = names.filter(n => CHECKPOINT_NAME.test(n)).sort().reverse();

  for (const name of sorted) {
    const cpDir = path.join(root, name);
    try {
      const manifest = JSON.parse(await fsP.readFile(path.join(cpDir, 'manifest.json'), 'utf8'));
      if (manifest.cwd === cwd && !manifest.undone) {
        return { cpDir, manifest };
      }
    } catch {
      // Повреждённый или неполный чекпоинт пропускаем
    }
  }
  return null;
}

/**
 * Сверяет путь с состоянием после хода, чтобы не затереть правки, сделанные позже.
 *
 * @param {object} entry - Запись манифеста
 * @returns {Promise<boolean>} true, если запись можно откатить
 */
async function matchesStateAfterTurn(entry) {
  if (entry.after === undefined) return true;
  if (entry.after === null) {
    // Пустая папка могла остаться от отката файла, созданного заново: терять в ней нечего
    await fsP.rmdir(entry.path).catch(() => {});
    return !(await pathExists(entry.path));
  }
  return sha256File(entry.path).then(hash => hash === entry.after, () => false);
}

/**
 * Откатывает одну запись. Правка возвращается копированием поверх файла:
 * перенос заменил бы символическую ссылку обычным файлом.
 *
 * @param {object} entry - Запись манифеста
 * @param {string} cpDir - Каталог чекпоинта
 */
async function restoreEntry(entry, cpDir) {
  if (!entry.existed) {
    await fsP.rm(entry.path, { force: true });
    return;
  }

  const backupPath = path.join(cpDir, entry.backup);
  await fsP.mkdir(path.dirname(entry.path), { recursive: true });
  if (entry.after === null) {
    await movePath(backupPath, entry.path);
  } else {
    await fsP.copyFile(backupPath, entry.path);
  }
}

/**
 * Отменяет последний чекпоинт папки, записи откатываются в обратном порядке.
 * При конфликтах каталог чекпоинта остаётся: в нём лежат копии, которые не удалось вернуть.
 * Такой чекпоинт помечается отменённым, чтобы следующий /undo пошёл к предыдущему.
 *
 * @param {string} cwd - Рабочая директория (realpath)
 * @returns {Promise<{ restored: string[], conflicts: string[], backupDir: string|null }|null>}
 */
export async function undoLastCheckpoint(cwd) {
  const found = await findLastCheckpoint(checkpointsRoot(), cwd);
  if (!found) return null;

  const { cpDir, manifest } = found;
  const restored = new Set();
  const conflicts = new Set();

  for (const entry of [...manifest.entries].reverse()) {
    const rel = path.relative(cwd, entry.path);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    try {
      if (!inside || !(await matchesStateAfterTurn(entry))) {
        conflicts.add(rel);
        continue;
      }
      await restoreEntry(entry, cpDir);
      restored.add(rel);
    } catch {
      conflicts.add(rel);
    }
  }

  if (conflicts.size > 0) {
    manifest.undone = true;
    await saveManifest(cpDir, manifest);
  } else {
    await fsP.rm(cpDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    restored: [...restored].filter(rel => !conflicts.has(rel)),
    conflicts: [...conflicts],
    backupDir: conflicts.size > 0 ? cpDir : null
  };
}
