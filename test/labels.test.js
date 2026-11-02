import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeBrokenLabels } from '../src/images.js';

test('Backspace на последнем символе подписи удаляет её целиком', () => {
  const prev = 'Перед [Изображение #1]';
  const next = 'Перед [Изображение #1';
  const labels = ['[Изображение #1]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), 'Перед ');
});

test('удаление символа в середине подписи удаляет её целиком', () => {
  const prev = '[Изображение #1] конец';
  const next = '[Изображени #1] конец';
  const labels = ['[Изображение #1]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), ' конец');
});

test('удаление символа сразу после подписи не трогает подпись', () => {
  const prev = '[Изображение #1] текст';
  const next = '[Изображение #1] екст';
  const labels = ['[Изображение #1]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), '[Изображение #1] екст');
});

test('обычное удаление в тексте без подписей возвращает next', () => {
  const prev = 'простой текст';
  const next = 'простой тест';
  const labels = ['[Изображение #1]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), 'простой тест');
});

test('из двух подписей удаляется только задетая', () => {
  const prev = '[Изображение #1] и [Изображение #2]';
  const next = '[Изображение #1] и [Изображение #2';
  const labels = ['[Изображение #1]', '[Изображение #2]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), '[Изображение #1] и ');
});

test('вставка символа возвращает next', () => {
  const prev = 'Привет [Изображение #1]';
  const next = 'Привет! [Изображение #1]';
  const labels = ['[Изображение #1]'];

  assert.strictEqual(removeBrokenLabels(prev, next, labels), 'Привет! [Изображение #1]');
});
