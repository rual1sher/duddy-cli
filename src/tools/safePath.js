/** @fileoverview Безопасное разрешение путей в рабочей папке и валидация путей к файлам */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolves a target path safely within the root working directory.
 * Protects against directory traversal and symlink breakout.
 *
 * @param {string} targetPath - Path to resolve
 * @param {object} [options]
 * @param {boolean} [options.followFinalSymlink=true] - Whether to follow symlinks for the final target
 * @returns {Promise<{ fullPath: string, relPath: string, error: string|null }>}
 */
export async function resolveSafePath(targetPath, { followFinalSymlink = true } = {}) {
  const root = await fs.realpath(process.cwd());
  const fullPath = path.resolve(root, targetPath || '.');
  const relPath = path.relative(root, fullPath) || '.';

  let curr = fullPath;
  const segments = [];

  if (!followFinalSymlink && fullPath !== root) {
    segments.push(path.basename(fullPath));
    curr = path.dirname(fullPath);
  }

  let real;
  while (true) {
    try {
      const realCurr = await fs.realpath(curr);
      const tail = [...segments].reverse();
      real = tail.length > 0 ? path.join(realCurr, ...tail) : realCurr;
      break;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // A dangling symlink also yields ENOENT, but writing through it would escape root
        const isDanglingLink = await fs.lstat(curr).then(s => s.isSymbolicLink(), () => false);
        if (isDanglingLink) {
          return {
            fullPath,
            relPath,
            error: `Ошибка: Доступ запрещён — путь "${targetPath}" ведёт через битую символическую ссылку.`
          };
        }
        const parent = path.dirname(curr);
        if (parent === curr) {
          const tail = [...segments].reverse();
          real = tail.length > 0 ? path.join(curr, ...tail) : curr;
          break;
        }
        segments.push(path.basename(curr));
        curr = parent;
      } else {
        throw err;
      }
    }
  }

  const rel = path.relative(root, real);
  const isOutside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);

  if (isOutside) {
    return {
      fullPath,
      relPath,
      error: `Ошибка: Доступ запрещён — путь "${targetPath}" находится за пределами рабочей папки ${root}.`
    };
  }

  return { fullPath, relPath, error: null };
}

/**
 * Validates that targetPath is a valid file path and not a directory or empty
 */
export function validateFilePath(targetPath, toolName) {
  if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim() || targetPath.trim() === '.' || targetPath.trim() === './') {
    return `Ошибка: Не указано имя файла в параметре path (получено "${targetPath || ''}"). Укажите путь к файлу, например: "index.html".`;
  }
  return null;
}
