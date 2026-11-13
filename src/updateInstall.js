/**
 * @fileoverview Установка и обновление Duddy (скачивание install.sh и раскладка по версиям)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { REPO, parseVersion, compareVersions, fetchReleases } from './update.js';

/**
 * Определяет способ установки Duddy (управляемая через ~/.local/share/duddy или git/разработка).
 * Читает os.homedir() динамически при каждом вызове.
 *
 * @returns {Promise<{ managed: boolean, root: string, installDir: string }>}
 */
export async function detectInstall() {
  const packageDir = fileURLToPath(new URL('..', import.meta.url));
  let root;
  try {
    root = await fs.realpath(packageDir);
  } catch {
    root = path.resolve(packageDir);
  }
  const installDir = path.join(os.homedir(), '.local/share/duddy');
  const versionsDir = path.join(installDir, 'versions');
  const rel = path.relative(versionsDir, root);
  const managed = !rel.startsWith('..') && !path.isAbsolute(rel) && rel !== '';
  return { managed, root, installDir };
}

/**
 * Выполняет обновление Duddy без git clone (скачивание install.sh и запуск по версиям).
 * Выполняется строго асинхронно без блокировки event loop.
 *
 * @param {object} [options]
 * @param {string} [options.version] - Целевая версия (если не указана, берётся последняя)
 * @param {Function} [options.onLine] - Callback для передачи строк вывода
 * @param {Function} [options.fetchImpl] - Реализация fetch
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function runUpdate({ version, onLine, fetchImpl = globalThis.fetch } = {}) {
  let targetVersion = null;
  if (version !== undefined && version !== null) {
    const parsed = parseVersion(version);
    if (!parsed) {
      return { ok: false, message: `Неверная версия: ${version}` };
    }
    targetVersion = parsed.join('.');
  }

  const install = await detectInstall();
  if (!install.managed) {
    return {
      ok: false,
      message: `Duddy запущен из папки ${install.root} (git/разработка). Обновите через git pull.`
    };
  }

  if (!targetVersion) {
    let currentVersion = '0.0.0';
    try {
      const pkgContent = await fs.readFile(path.join(install.root, 'package.json'), 'utf8');
      currentVersion = JSON.parse(pkgContent).version || '0.0.0';
    } catch {}

    const releases = await fetchReleases({ fetchImpl });
    if (!releases || releases.length === 0) {
      return { ok: false, message: 'Не удалось получить список релизов с GitHub' };
    }
    const cur = parseVersion(currentVersion);
    const sorted = [...releases].sort((a, b) => compareVersions(b.parsedVersion, a.parsedVersion));
    const latestRel = sorted[0];
    if (!latestRel) {
      return { ok: false, message: 'Релизы не найдены' };
    }
    if (cur && compareVersions(latestRel.parsedVersion, cur) <= 0) {
      return { ok: true, message: `Уже последняя версия v${cur.join('.')}` };
    }
    targetVersion = latestRel.parsedVersion.join('.');
  }

  const scriptUrl = `https://raw.githubusercontent.com/${REPO}/v${targetVersion}/install.sh`;
  let scriptText;
  try {
    const res = await fetchImpl(scriptUrl);
    if (!res.ok) {
      return { ok: false, message: `Не удалось скачать скрипт установки: HTTP ${res.status}` };
    }
    scriptText = await res.text();
  } catch (err) {
    return { ok: false, message: `Ошибка скачивания скрипта установки: ${err.message}` };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-update-'));
  const tmpFile = path.join(tempDir, 'install.sh');
  try {
    await fs.writeFile(tmpFile, scriptText, { mode: 0o755 });

    const lines = [];
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    const child = spawn('bash', [tmpFile], {
      cwd: tempDir,
      env: { ...process.env, DUDDY_VERSION: targetVersion },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const handleChunk = (chunk) => {
      const text = chunk.toString('utf8');
      for (const rawLine of text.split('\n')) {
        const clean = stripAnsi(rawLine).trimEnd();
        if (clean) {
          lines.push(clean);
          if (typeof onLine === 'function') {
            onLine(clean);
          }
        }
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    const exitCode = await new Promise((resolve) => {
      child.on('close', resolve);
      child.on('error', (err) => {
        lines.push(`Ошибка запуска: ${err.message}`);
        resolve(1);
      });
    });

    if (exitCode === 0) {
      return { ok: true, message: `Duddy обновлён до v${targetVersion}. Перезапустите duddy.` };
    }

    const last5 = lines.slice(-5).join('\n') || 'нет вывода';
    return { ok: false, message: `Обновление не удалось (код ${exitCode}): ${last5}` };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
