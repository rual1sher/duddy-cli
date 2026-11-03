import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { KITTEN_ROWS, kittenLines, bannerLines } from '../src/banner.js';

test('kittenLines() возвращает 3 строки, каждая по 7 видимых колонок, равные точному образцу', () => {
  const lines = kittenLines();
  assert.strictEqual(lines.length, 3);
  for (const line of lines) {
    const stripped = stripVTControlCharacters(line);
    assert.strictEqual(stripped.length, 7);
  }
  const stripped = lines.map(stripVTControlCharacters);
  assert.deepStrictEqual(stripped, ['█▖   ▗█', '█▀███▀█', '▜██▄██▛']);
});

test('kittenLines({ rise: 6 }) возвращает 3 строки из 7 пробелов', () => {
  const lines = kittenLines({ rise: 6 });
  assert.strictEqual(lines.length, 3);
  for (const line of lines) {
    const stripped = stripVTControlCharacters(line);
    assert.strictEqual(stripped, ' '.repeat(7));
  }
});

test('kittenLines({ twitch: true }) отличается от kittenLines() по первой строке', () => {
  const defaultLine0 = stripVTControlCharacters(kittenLines()[0]);
  const twitchLine0 = stripVTControlCharacters(kittenLines({ twitch: true })[0]);
  assert.notStrictEqual(twitchLine0, defaultLine0);
});

test('kittenLines({ blink: true }) отличается от kittenLines() по строке 1', () => {
  const defaultLine1 = stripVTControlCharacters(kittenLines()[1]);
  const blinkLine1 = stripVTControlCharacters(kittenLines({ blink: true })[1]);
  assert.notStrictEqual(blinkLine1, defaultLine1);
});

test('bannerLines({ model: "m1", hasKey: true }) содержит 5 строк с Duddy и m1', () => {
  const lines = bannerLines({ model: 'm1', hasKey: true });
  assert.strictEqual(lines.length, 5);
  const strippedText = lines.map(stripVTControlCharacters).join('\n');
  assert.ok(strippedText.includes('Duddy'));
  assert.ok(strippedText.includes('m1'));
});

test('bannerLines(..., { reveal: 0 }) содержит 5 строк и не содержит Duddy в выводе', () => {
  const lines = bannerLines({ model: 'm1', hasKey: true }, { reveal: 0 });
  assert.strictEqual(lines.length, 5);
  const strippedText = lines.map(stripVTControlCharacters).join('\n');
  assert.ok(!strippedText.includes('Duddy'));
});

test('KITTEN_ROWS экспортирует массив из 6 строк по 14 символов', () => {
  assert.strictEqual(KITTEN_ROWS.length, 6);
  for (const row of KITTEN_ROWS) {
    assert.strictEqual(row.length, 14);
  }
});
