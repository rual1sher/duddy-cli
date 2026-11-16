import React from 'react';
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkingIndicator, phaseLabel } from '../src/ui/WorkingIndicator.js';

const h = React.createElement;

function renderIndicator(props) {
  const stdout = new EventEmitter();
  stdout.columns = 80;
  stdout.rows = 24;
  let frame = '';
  stdout.write = (chunk) => {
    frame = String(chunk);
    return true;
  };

  const app = render(h(WorkingIndicator, props), {
    stdout,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false
  });

  return { frame: () => frame, unmount: () => app.unmount() };
}

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

test('WorkingIndicator: при waitingForUser: true показывает «Ждёт подтверждения…» без времени', () => {
  const ui = renderIndicator({
    status: 'working',
    phase: 'thinking',
    startedAt: Date.now() - 5000,
    waitingForUser: true
  });
  const text = ui.frame();
  assert.ok(text.includes('Ждёт подтверждения…'), `Текст должен содержать фазу: ${text}`);
  assert.ok(!text.includes('5.0s'), `Текст не должен содержать время при ожидании: ${text}`);
  assert.ok(!text.includes('0.0s'), `Текст не должен содержать время при ожидании: ${text}`);
  ui.unmount();
});

test('WorkingIndicator: при waitingForUser: false вычитает getPausedMs из времени работы', () => {
  const now = Date.now();
  const ui = renderIndicator({
    status: 'working',
    phase: 'thinking',
    startedAt: now - 5000,
    waitingForUser: false,
    getPausedMs: () => 3000
  });
  const text = ui.frame();
  assert.ok(text.includes('Думает…'), `Текст должен содержать фазу: ${text}`);
  assert.ok(text.includes('2.0s') || text.includes('2.1s'), `Время должно быть уменьшено на getPausedMs: ${text}`);
  ui.unmount();
});
