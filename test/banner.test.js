import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { bannerLines, HINT } from '../src/render/banner.js';

test('bannerLines возвращает 3 строки', () => {
  const lines = bannerLines({ model: 'm1', hasKey: true });
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], '');
});

test('bannerLines с hasKey: true — строка 2 содержит "Duddy" и модель', () => {
  const lines = bannerLines({ model: 'test-model', hasKey: true });
  const line2 = stripVTControlCharacters(lines[1]);
  assert.ok(line2.includes('Duddy'), `Строка 2 должна содержать Duddy: "${line2}"`);
  assert.ok(line2.includes('test-model'), `Строка 2 должна содержать модель: "${line2}"`);
});

test('bannerLines с hasKey: false — строка 2 содержит "/login"', () => {
  const lines = bannerLines({ model: 'test-model', hasKey: false });
  const line2 = stripVTControlCharacters(lines[1]);
  assert.ok(line2.includes('/login'), `Строка 2 должна содержать /login: "${line2}"`);
});

test('bannerLines — строка 3 содержит "/ — команды"', () => {
  const lines = bannerLines({ model: 'test-model', hasKey: true });
  const line3 = stripVTControlCharacters(lines[2]);
  assert.ok(line3.includes('/ — команды'), `Строка 3 должна содержать "/ — команды": "${line3}"`);
});

test('bannerLines при узком терминале (cols=40) не переносит строки, при cols=120 содержит подсказку', () => {
  const origCols = process.stdout.columns;
  try {
    process.stdout.columns = 40;
    const longCwd = '/var/log/very/deeply/nested/directory/structure/that/exceeds/the/terminal/width/project';
    const narrowLines = bannerLines({ cwd: longCwd, model: 'test-model', hasKey: true });
    assert.strictEqual(narrowLines.length, 3);
    for (const line of narrowLines) {
      const visible = stripVTControlCharacters(line);
      assert.ok(
        visible.length <= 40,
        `Видимая длина строки (${visible.length}) должна быть <= 40: "${visible}"`
      );
    }
    const narrowLine3 = stripVTControlCharacters(narrowLines[2]);
    assert.ok(!narrowLine3.includes(HINT), 'При cols=40 подсказка не должна выводиться');

    process.stdout.columns = 120;
    const wideLines = bannerLines({ cwd: longCwd, model: 'test-model', hasKey: true });
    const wideLine3 = stripVTControlCharacters(wideLines[2]);
    assert.ok(wideLine3.includes(HINT), 'При cols=120 строка 3 должна содержать подсказку');
  } finally {
    process.stdout.columns = origCols;
  }
});
