import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseLabel } from '../src/ui/WorkingIndicator.js';

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
