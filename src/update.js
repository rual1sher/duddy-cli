/**
 * @fileoverview Проверка обновлений и обновление Duddy (GitHub Releases)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const REPO = 'rual1sher/duddy-cli';

/**
 * Разбирает строку версии SemVer вида "1.2.3" или "v1.2.3".
 * Суффиксы (-beta, -rc) возвращают null.
 *
 * @param {string} str - Строка версии
 * @returns {[number, number, number] | null} [major, minor, patch] или null
 */
export function parseVersion(str) {
  if (typeof str !== 'string') return null;
  const match = str.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Сравнивает две версии.
 *
 * @param {string|[number, number, number]} a - Первая версия
 * @param {string|[number, number, number]} b - Вторая версия
 * @returns {-1 | 0 | 1} -1 если a < b, 0 если a == b, 1 если a > b
 */
export function compareVersions(a, b) {
  const pa = Array.isArray(a) ? a : parseVersion(a);
  const pb = Array.isArray(b) ? b : parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Определяет тип обновления (major, minor, patch).
 * Возвращает null, если latest не новее current.
 *
 * @param {string|[number, number, number]} current - Текущая версия
 * @param {string|[number, number, number]} latest - Последняя доступная версия
 * @returns {'major' | 'minor' | 'patch' | null}
 */
export function updateKind(current, latest) {
  const cur = Array.isArray(current) ? current : parseVersion(current);
  const lat = Array.isArray(latest) ? latest : parseVersion(latest);
  if (!cur || !lat) return null;
  if (compareVersions(lat, cur) <= 0) return null;
  if (lat[0] > cur[0]) return 'major';
  if (lat[1] > cur[1]) return 'minor';
  if (lat[2] > cur[2]) return 'patch';
  return null;
}

/**
 * Загружает список релизов из GitHub API.
 * Пропускает черновики, пререлизы и неподходящие теги.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Реализация fetch
 * @param {number} [options.timeoutMs] - Таймаут запроса в мс
 * @returns {Promise<Array<object> | null>}
 */
export async function fetchReleases({ fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'duddy-cli'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data
      .filter((r) => r && !r.draft && !r.prerelease && r.tag_name)
      .map((r) => {
        const parsed = parseVersion(r.tag_name);
        return parsed ? { ...r, parsedVersion: parsed } : null;
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Проверяет наличие новой версии на GitHub.
 * Никогда не выбрасывает исключений (при ошибках возвращает null).
 *
 * @param {string} currentVersion - Текущая версия приложения
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Реализация fetch
 * @param {number} [options.timeoutMs] - Таймаут запроса
 * @returns {Promise<{ current: string, latest: string, kind: 'major'|'minor'|'patch', critical: boolean, url: string } | null>}
 */
export async function checkForUpdate(currentVersion, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (process.env.DUDDY_NO_UPDATE_CHECK === '1') {
    return null;
  }
  try {
    const cur = parseVersion(currentVersion);
    if (!cur) return null;

    const releases = await fetchReleases({ fetchImpl, timeoutMs });
    if (!releases || releases.length === 0) return null;

    const newer = releases.filter((r) => compareVersions(r.parsedVersion, cur) > 0);
    if (newer.length === 0) return null;

    const latestRel = newer.reduce((max, r) => (compareVersions(r.parsedVersion, max.parsedVersion) > 0 ? r : max));
    const latest = latestRel.parsedVersion.join('.');
    const current = cur.join('.');
    const kind = updateKind(cur, latestRel.parsedVersion);
    const critical = newer.some((r) => /\[critical\]/i.test(r.body || ''));

    return {
      current,
      latest,
      kind,
      critical,
      url: latestRel.html_url || ''
    };
  } catch {
    return null;
  }
}

/**
 * Формирует человекочитаемое сообщение о доступном обновлении.
 *
 * @param {object} info - Результат checkForUpdate
 * @returns {{ level: 'error' | 'warn' | 'info', text: string }}
 */
export function updateMessage(info) {
  if (!info) return null;
  if (info.critical) {
    return {
      level: 'error',
      text: `⚠ Критичное обновление безопасности: v${info.latest} (у вас v${info.current}). Обновитесь: /update`
    };
  }
  if (info.kind === 'major') {
    return {
      level: 'warn',
      text: `Вышла v${info.latest} — есть несовместимые изменения, см. ${info.url}. Обновить: /update`
    };
  }
  if (info.kind === 'minor') {
    return {
      level: 'info',
      text: `Доступна v${info.latest} с новыми функциями. Обновить: /update`
    };
  }
  return {
    level: 'info',
    text: `Доступна v${info.latest} с исправлениями. Обновить: /update`
  };
}

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
