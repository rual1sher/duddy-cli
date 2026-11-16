import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyLines } from '../src/render/formatter.js';

test('tidyLines: пустой массив → пустой массив', () => {
  assert.deepStrictEqual(tidyLines([]), []);
});

test('tidyLines: null/undefined → пустой массив', () => {
  assert.deepStrictEqual(tidyLines(null), []);
  assert.deepStrictEqual(tidyLines(undefined), []);
});

test('tidyLines: убирает пустые строки в начале и конце', () => {
  const input = ['', '  ', 'Привет', 'Мир', '', '  '];
  assert.deepStrictEqual(tidyLines(input), ['Привет', 'Мир']);
});

test('tidyLines: схлопывает несколько пустых строк подряд в одну', () => {
  const input = ['Строка 1', '', '', '', 'Строка 2', '', '', 'Строка 3'];
  assert.deepStrictEqual(tidyLines(input), ['Строка 1', '', 'Строка 2', '', 'Строка 3']);
});

test('tidyLines: строки только из пробелов считаются пустыми', () => {
  const input = ['Текст', '   ', '\t', 'Ещё текст'];
  assert.deepStrictEqual(tidyLines(input), ['Текст', '', 'Ещё текст']);
});

test('tidyLines: строки с текстом не изменяются', () => {
  const input = ['  отступ сохраняется  ', '**жирный**', '`код`'];
  assert.deepStrictEqual(tidyLines(input), ['  отступ сохраняется  ', '**жирный**', '`код`']);
});

test('tidyLines: массив из одних пустых строк → пустой массив', () => {
  assert.deepStrictEqual(tidyLines(['', '  ', '\n']), []);
});

test('tidyLines: одна непустая строка остаётся', () => {
  assert.deepStrictEqual(tidyLines(['Hello']), ['Hello']);
});

test('tidyLines: пустые строки между блоками кода сохраняются в количестве одной', () => {
  const input = ['```js', 'code()', '```', '', '', '', '## Заголовок'];
  assert.deepStrictEqual(tidyLines(input), ['```js', 'code()', '```', '', '## Заголовок']);
});

test('tidyLines: не добавляет пустую строку в начало если первая строка непустая', () => {
  const input = ['Первая', '', 'Вторая'];
  const result = tidyLines(input);
  assert.strictEqual(result[0], 'Первая');
});
