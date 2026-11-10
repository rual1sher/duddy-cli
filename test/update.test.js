import { test, describe, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

// Подмена process.env.HOME на временную папку ДО импорта модуля
const testTmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-update-test-home-'));
const originalHome = process.env.HOME;
process.env.HOME = testTmpHome;

const {
  REPO,
  parseVersion,
  compareVersions,
  updateKind,
  fetchReleases,
  checkForUpdate,
  updateMessage,
  detectInstall,
  runUpdate
} = await import('../src/update.js');

const originalFetch = globalThis.fetch;
const originalNoUpdateCheck = process.env.DUDDY_NO_UPDATE_CHECK;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalNoUpdateCheck === undefined) {
    delete process.env.DUDDY_NO_UPDATE_CHECK;
  } else {
    process.env.DUDDY_NO_UPDATE_CHECK = originalNoUpdateCheck;
  }
});

after(async () => {
  process.env.HOME = originalHome;
  try {
    await fs.rm(testTmpHome, { recursive: true, force: true });
  } catch {}
});

describe('update module', () => {
  test('parseVersion: корректный разбор SemVer и отсечение суффиксов', () => {
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v0.0.1'), [0, 0, 1]);
    assert.deepEqual(parseVersion('10.20.30'), [10, 20, 30]);

    assert.equal(parseVersion('v1.2.3-beta'), null);
    assert.equal(parseVersion('1.2.3-rc.1'), null);
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('v1'), null);
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(null), null);
    assert.equal(parseVersion(undefined), null);
    assert.equal(parseVersion(123), null);
  });

  test('compareVersions: сравнение версий (-1, 0, 1)', () => {
    assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
    assert.equal(compareVersions([1, 2, 0], [1, 3, 0]), -1);
    assert.equal(compareVersions('invalid', '1.2.0'), 0);
  });

  test('updateKind: определение типа обновления (patch, minor, major, null)', () => {
    assert.equal(updateKind('1.2.0', '1.2.1'), 'patch');
    assert.equal(updateKind('1.2.0', '1.3.0'), 'minor');
    assert.equal(updateKind('1.2.0', '2.0.0'), 'major');
    assert.equal(updateKind('1.2.0', '2.1.5'), 'major');

    // Если latest не новее current
    assert.equal(updateKind('1.2.0', '1.2.0'), null);
    assert.equal(updateKind('1.2.1', '1.2.0'), null);
    assert.equal(updateKind('2.0.0', '1.9.9'), null);
  });

  test('checkForUpdate: DUDDY_NO_UPDATE_CHECK=1 возвращает null без вызова fetch', async () => {
    process.env.DUDDY_NO_UPDATE_CHECK = '1';
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    };

    const res = await checkForUpdate('1.2.0', { fetchImpl });
    assert.equal(res, null);
    assert.equal(fetchCalled, false);
  });

  test('checkForUpdate: нет новее → возвращает null', async () => {
    const releases = [
      {
        tag_name: 'v1.2.0',
        draft: false,
        prerelease: false,
        body: 'Release 1.2.0',
        html_url: 'https://example.com/1.2.0'
      },
      {
        tag_name: 'v1.1.0',
        draft: false,
        prerelease: false,
        body: 'Release 1.1.0',
        html_url: 'https://example.com/1.1.0'
      }
    ];

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => releases
    });

    const res = await checkForUpdate('1.2.0', { fetchImpl });
    assert.equal(res, null);
  });

  test('checkForUpdate: draft и prerelease игнорируются', async () => {
    const releases = [
      {
        tag_name: 'v2.0.0',
        draft: true,
        prerelease: false,
        body: 'Draft 2.0.0',
        html_url: 'https://example.com/2.0.0'
      },
      {
        tag_name: 'v1.3.0',
        draft: false,
        prerelease: true,
        body: 'Pre-release 1.3.0',
        html_url: 'https://example.com/1.3.0'
      },
      {
        tag_name: 'v1.2.0',
        draft: false,
        prerelease: false,
        body: 'Stable 1.2.0',
        html_url: 'https://example.com/1.2.0'
      }
    ];

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => releases
    });

    const res = await checkForUpdate('1.2.0', { fetchImpl });
    assert.equal(res, null);
  });

  test('checkForUpdate: critical из промежуточного релиза при latest без маркера', async () => {
    const releases = [
      {
        tag_name: 'v1.4.0',
        draft: false,
        prerelease: false,
        body: 'Новые функции и улучшения',
        html_url: 'https://github.com/rual1sher/duddy-cli/releases/tag/v1.4.0'
      },
      {
        tag_name: 'v1.3.0',
        draft: false,
        prerelease: false,
        body: 'Срочный фикс уязвимости [critical]',
        html_url: 'https://github.com/rual1sher/duddy-cli/releases/tag/v1.3.0'
      },
      {
        tag_name: 'v1.2.0',
        draft: false,
        prerelease: false,
        body: 'Базовый релиз',
        html_url: 'https://github.com/rual1sher/duddy-cli/releases/tag/v1.2.0'
      }
    ];

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => releases
    });

    const res = await checkForUpdate('1.2.0', { fetchImpl });
    assert.deepEqual(res, {
      current: '1.2.0',
      latest: '1.4.0',
      kind: 'minor',
      critical: true,
      url: 'https://github.com/rual1sher/duddy-cli/releases/tag/v1.4.0'
    });
  });

  test('checkForUpdate: сетевая ошибка, 500 и кривой JSON возвращают null', async () => {
    // Сетевая ошибка (throw)
    const failFetch = async () => {
      throw new Error('Network timeout');
    };
    assert.equal(await checkForUpdate('1.2.0', { fetchImpl: failFetch }), null);

    // Статус 500
    const http500Fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' })
    });
    assert.equal(await checkForUpdate('1.2.0', { fetchImpl: http500Fetch }), null);

    // Кривой JSON
    const badJsonFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      }
    });
    assert.equal(await checkForUpdate('1.2.0', { fetchImpl: badJsonFetch }), null);
  });

  test('updateMessage: корректные уровни сообщений и текст', () => {
    // critical
    const crit = updateMessage({
      current: '1.2.0',
      latest: '1.2.1',
      kind: 'patch',
      critical: true,
      url: 'https://example.com'
    });
    assert.equal(crit.level, 'error');
    assert.equal(crit.text, '⚠ Критичное обновление безопасности: v1.2.1 (у вас v1.2.0). Обновитесь: /update');

    // major
    const maj = updateMessage({
      current: '1.2.0',
      latest: '2.0.0',
      kind: 'major',
      critical: false,
      url: 'https://example.com/releases/v2.0.0'
    });
    assert.equal(maj.level, 'warn');
    assert.equal(maj.text, 'Вышла v2.0.0 — есть несовместимые изменения, см. https://example.com/releases/v2.0.0. Обновить: /update');

    // minor
    const min = updateMessage({
      current: '1.2.0',
      latest: '1.3.0',
      kind: 'minor',
      critical: false,
      url: 'https://example.com'
    });
    assert.equal(min.level, 'info');
    assert.equal(min.text, 'Доступна v1.3.0 с новыми функциями. Обновить: /update');

    // patch
    const pat = updateMessage({
      current: '1.2.0',
      latest: '1.2.1',
      kind: 'patch',
      critical: false,
      url: 'https://example.com'
    });
    assert.equal(pat.level, 'info');
    assert.equal(pat.text, 'Доступна v1.2.1 с исправлениями. Обновить: /update');

    // null info
    assert.equal(updateMessage(null), null);
  });

  test('detectInstall: корень проекта не является managed', async () => {
    const install = await detectInstall();
    assert.equal(install.managed, false);
    assert.ok(typeof install.root === 'string' && install.root.length > 0);
    assert.equal(install.installDir, path.join(testTmpHome, '.local/share/duddy'));
  });

  test('runUpdate: безопасная проверка ветки не managed', async () => {
    const res = await runUpdate();
    assert.equal(res.ok, false);
    assert.match(res.message, /^Duddy запущен из папки .* \(git\/разработка\)\. Обновите через git pull\.$/);
  });

  test('runUpdate: неверная версия возвращает ошибку валидации', async () => {
    const res = await runUpdate({ version: 'invalid-version' });
    assert.deepEqual(res, { ok: false, message: 'Неверная версия: invalid-version' });

    const res2 = await runUpdate({ version: '1.2.3-beta' });
    assert.deepEqual(res2, { ok: false, message: 'Неверная версия: 1.2.3-beta' });
  });
});
