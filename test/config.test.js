import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта, чтобы config.js взял наш путь
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-config-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

after(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

const { loadConfig, saveConfig } = await import('../src/config.js');

const CONFIG_DIR = path.join(tmpHome, '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function cleanConfig() {
  try { fs.rmSync(CONFIG_FILE, { force: true }); } catch { /* ignore */ }
  // also clean .broken and .tmp files
  try {
    const entries = fs.readdirSync(CONFIG_DIR);
    for (const e of entries) {
      if (e.startsWith('config.json')) {
        fs.rmSync(path.join(CONFIG_DIR, e), { force: true });
      }
    }
  } catch { /* ignore */ }
}

test('saveConfig на битом файле: создаёт .broken-<число>, новый config.json валиден', () => {
  ensureConfigDir();
  cleanConfig();

  const brokenContent = 'это не JSON!!!';
  fs.writeFileSync(CONFIG_FILE, brokenContent, { encoding: 'utf8', mode: 0o600 });

  saveConfig({ model: 'x' });

  // Должен появиться .broken-<число>
  const entries = fs.readdirSync(CONFIG_DIR);
  const brokenFiles = entries.filter(e => /^config\.json\.broken-\d+$/.test(e));
  assert.strictEqual(brokenFiles.length, 1, 'должен быть ровно один .broken файл');

  const brokenPath = path.join(CONFIG_DIR, brokenFiles[0]);
  const brokenData = fs.readFileSync(brokenPath, 'utf8');
  assert.strictEqual(brokenData, brokenContent, 'broken файл содержит оригинальные байты');

  // Права 0o600
  const brokenMode = fs.statSync(brokenPath).mode & 0o777;
  assert.strictEqual(brokenMode, 0o600, 'broken файл должен иметь права 0o600');

  // Новый config.json валиден
  const newData = fs.readFileSync(CONFIG_FILE, 'utf8');
  const parsed = JSON.parse(newData);
  assert.strictEqual(parsed.model, 'x');
});

test('loadConfig на битом файле: возвращает дефолты и один раз пишет warning в stderr', () => {
  ensureConfigDir();
  cleanConfig();

  fs.writeFileSync(CONFIG_FILE, '{ broken json', { encoding: 'utf8', mode: 0o600 });

  const stderrWrites = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data, ...rest) => {
    stderrWrites.push(data);
    return origWrite(data, ...rest);
  };

  let cfg1, cfg2;
  try {
    cfg1 = loadConfig();
    cfg2 = loadConfig();
  } finally {
    process.stderr.write = origWrite;
  }

  // Возвращает дефолты (provider === 'openrouter')
  assert.strictEqual(cfg1.provider, 'openrouter');
  assert.strictEqual(cfg2.provider, 'openrouter');

  // Warning написан ровно один раз (из-за флага _brokenConfigWarned)
  const warnings = stderrWrites.filter(s => String(s).includes('config.json'));
  assert.strictEqual(warnings.length, 1, 'warning должен быть написан ровно один раз');
});

test('saveConfig сохраняет ранее сохранённые ключи, права 0o600, нет tmp файлов', () => {
  ensureConfigDir();
  cleanConfig();

  // Сохраняем первый раз
  saveConfig({ model: 'first-model', apiKey: 'mykey' });

  // Сохраняем второй раз — ключи должны сохраниться
  saveConfig({ model: 'second-model' });

  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  assert.strictEqual(data.model, 'second-model');
  assert.strictEqual(data.apiKey, 'mykey', 'ключ должен сохраниться из первого saveConfig');

  // Права файла 0o600
  const mode = fs.statSync(CONFIG_FILE).mode & 0o777;
  assert.strictEqual(mode, 0o600, 'config.json должен иметь права 0o600');

  // Нет tmp файлов
  const entries = fs.readdirSync(CONFIG_DIR);
  const tmpFiles = entries.filter(e => e.includes('.tmp-'));
  assert.strictEqual(tmpFiles.length, 0, 'не должно остаться tmp файлов');
});

test('saveConfig: если переименование битого файла невозможно — config.json не тронут', () => {
  ensureConfigDir();
  cleanConfig();

  const brokenContent = '{ broken again';
  fs.writeFileSync(CONFIG_FILE, brokenContent, { encoding: 'utf8', mode: 0o600 });

  // Делаем папку недоступной для записи
  fs.chmodSync(CONFIG_DIR, 0o500);
  try {
    // saveConfig должен завершиться тихо (поглощает ошибку)
    saveConfig({ model: 'y' });
  } finally {
    fs.chmodSync(CONFIG_DIR, 0o700);
  }

  // config.json остаётся нетронутым
  const content = fs.readFileSync(CONFIG_FILE, 'utf8');
  assert.strictEqual(content, brokenContent, 'config.json должен оставаться нетронутым при ошибке переименования');
});

/** Глушит console.error и ломает только первый вызов renameSync: запись новых файлов остаётся возможной */
function failFirstRename(t) {
  t.mock.method(console, 'error', () => {});
  const realRename = fs.renameSync;
  let failed = false;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (!failed) {
      failed = true;
      throw Object.assign(new Error('сбой'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
}

test('saveConfig: сбой переноса битого файла отменяет сохранение, даже если запись возможна', (t) => {
  ensureConfigDir();
  cleanConfig();
  const brokenContent = '{"apiKey":"sk-or-важный",';
  fs.writeFileSync(CONFIG_FILE, brokenContent, { encoding: 'utf8', mode: 0o600 });

  failFirstRename(t);
  saveConfig({ model: 'y' });

  assert.strictEqual(fs.readFileSync(CONFIG_FILE, 'utf8'), brokenContent);
});

test('saveConfig: сбой записи не портит прежний файл и не оставляет временных', (t) => {
  ensureConfigDir();
  cleanConfig();
  saveConfig({ apiKey: 'sk-or-важный' });
  const before = fs.readFileSync(CONFIG_FILE, 'utf8');

  failFirstRename(t);
  saveConfig({ model: 'y' });

  assert.strictEqual(fs.readFileSync(CONFIG_FILE, 'utf8'), before);
  assert.deepStrictEqual(fs.readdirSync(CONFIG_DIR).filter(e => e.includes('.tmp-')), []);
});
