import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_PATH, ringPixels, ringCells, phaseLabel } from '../src/ui/WorkingIndicator.js';

test('RING_PATH: содержит 4 уникальные точки, покрывающие сетку 2×2', () => {
  assert.strictEqual(RING_PATH.length, 4);
  const unique = new Set(RING_PATH.map(([x, y]) => `${x},${y}`));
  assert.strictEqual(unique.size, 4);

  const expectedPath = [
    [0, 0], [1, 0], [1, 1], [0, 1]
  ];
  assert.deepStrictEqual(RING_PATH, expectedPath);

  for (const [x, y] of RING_PATH) {
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `Координаты (${x}, ${y}) вне диапазона 0..1`);
  }
});

test('ringPixels: каждый кадр содержит ровно по одному уровню каждой яркости', () => {
  for (let tick = 0; tick < 4; tick++) {
    const grid = ringPixels(tick);

    const counts = { head: 0, trail1: 0, trail2: 0, track: 0 };
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const val = grid[y][x];
        counts[val] = (counts[val] || 0) + 1;
      }
    }

    assert.strictEqual(counts.head, 1, `При tick=${tick} должен быть 1 head`);
    assert.strictEqual(counts.trail1, 1, `При tick=${tick} должен быть 1 trail1`);
    assert.strictEqual(counts.trail2, 1, `При tick=${tick} должен быть 1 trail2`);
    assert.strictEqual(counts.track, 1, `При tick=${tick} должен быть 1 track`);
  }
});

test('ringPixels: при tick 0 голова в (0,0), trail1 в (0,1), trail2 в (1,1), track в (1,0)', () => {
  const grid = ringPixels(0);
  assert.deepStrictEqual(grid, [
    ['head', 'track'],
    ['trail1', 'trail2']
  ]);
  assert.strictEqual(grid[0][0], 'head');
  assert.strictEqual(grid[1][0], 'trail1');
  assert.strictEqual(grid[1][1], 'trail2');
  assert.strictEqual(grid[0][1], 'track');
});

test('ringPixels: при tick 1 голова в (1,0), trail1 в (0,0)', () => {
  const grid = ringPixels(1);
  assert.strictEqual(grid[0][1], 'head');
  assert.strictEqual(grid[0][0], 'trail1');
  assert.deepStrictEqual(grid, [
    ['trail1', 'head'],
    ['trail2', 'track']
  ]);
});

test('ringPixels: циклическое повторение — ringPixels(4) deep-equals ringPixels(0)', () => {
  assert.deepStrictEqual(ringPixels(4), ringPixels(0));
});

test('ringCells(0): содержит 1 строку из 2 ячеек с символом ▀, ячейка 0 top head bottom trail1', () => {
  const cells = ringCells(0);

  assert.strictEqual(cells.length, 1);
  assert.strictEqual(cells[0].length, 2);

  assert.strictEqual(cells[0][0].char, '▀');
  assert.strictEqual(cells[0][0].top, 'head');
  assert.strictEqual(cells[0][0].bottom, 'trail1');

  assert.strictEqual(cells[0][1].char, '▀');
  assert.strictEqual(cells[0][1].top, 'track');
  assert.strictEqual(cells[0][1].bottom, 'trail2');
});

test('phaseLabel: корректно определяет текстовую метку для всех фаз и ожидания пользователя', () => {
  // waitingForUser имеет наивысший приоритет
  assert.strictEqual(phaseLabel(undefined, true), 'Ждёт подтверждения');
  assert.strictEqual(phaseLabel('reasoning', true), 'Ждёт подтверждения');
  assert.strictEqual(phaseLabel('tools', true), 'Ждёт подтверждения');
  assert.strictEqual(phaseLabel('unknown', true), 'Ждёт подтверждения');

  // Фазы без ожидания пользователя
  assert.strictEqual(phaseLabel('reasoning', false), 'Рассуждает');
  assert.strictEqual(phaseLabel('tools', false), 'Выполняет инструменты');
  assert.strictEqual(phaseLabel('thinking', false), 'Думает');
  assert.strictEqual(phaseLabel(undefined, false), 'Думает');
  assert.strictEqual(phaseLabel(null, false), 'Думает');
});
