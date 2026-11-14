import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до импорта, чтобы тесты гарантированно не затрагивали ~/.config/duddy
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-plain-renderer-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

after(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {}
});

const { headerDashCount, headerDashes } = await import('../src/render/plainRenderer.js');

test('headerDashCount / headerDashes: короткая метка дает 26 дефисов', () => {
  const label = 'gpt-4o';
  assert.strictEqual(headerDashCount(label, 80), 26);
  assert.strictEqual(headerDashes(label, 80), '─'.repeat(26));
});

test('headerDashCount / headerDashes: длинная метка укладывается в ширину терминала', () => {
  const longLabel = 'openrouter/free → nvidia/nemotron-3-ultra-550b-a55b:free';
  const columns = 80;
  const count = headerDashCount(longLabel, columns);
  const dashes = headerDashes(longLabel, columns);
  const prefix = `╭─ ✦ Duddy [${longLabel}] `;
  const fullWidth = prefix.length + dashes.length;

  assert.strictEqual(dashes.length, count);
  assert.ok(fullWidth <= columns, `Ширина заголовка (${fullWidth}) должна быть <= ${columns}`);
  assert.strictEqual(fullWidth, columns);
  assert.strictEqual(count, 10);
  assert.strictEqual(dashes, '─'.repeat(10));
});

test('headerDashCount / headerDashes: метка шире терминала дает 0 дефисов', () => {
  const longLabel = 'openrouter/free → nvidia/nemotron-3-ultra-550b-a55b:free';
  assert.strictEqual(headerDashCount(longLabel, 40), 0);
  assert.strictEqual(headerDashes(longLabel, 40), '');

  const hugeLabel = 'a'.repeat(90);
  assert.strictEqual(headerDashCount(hugeLabel, 80), 0);
  assert.strictEqual(headerDashes(hugeLabel, 80), '');
});

test('headerDashCount / headerDashes: по умолчанию использует process.stdout.columns || 80', () => {
  const origCols = process.stdout.columns;
  try {
    delete process.stdout.columns;
    assert.strictEqual(headerDashCount('gpt-4o'), 26);

    process.stdout.columns = 40;
    const longLabel = 'openrouter/free → nvidia/nemotron-3-ultra-550b-a55b:free';
    assert.strictEqual(headerDashCount(longLabel), 0);
    assert.strictEqual(headerDashes(longLabel), '');
  } finally {
    if (origCols !== undefined) {
      process.stdout.columns = origCols;
    } else {
      delete process.stdout.columns;
    }
  }
});
