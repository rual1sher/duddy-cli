import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-commands-test-'));
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

const { commandsFor, helpLines, AVAILABLE_COMMANDS } = await import('../src/commands.js');
const { catalogCache, clearCatalogCache } = await import('../src/models/catalog.js');

beforeEach(() => {
  clearCatalogCache();
  catalogCache.openrouter = [
    { id: 'openrouter/auto', name: 'Auto' },
    { id: 'anthropic/claude-3.7-sonnet', name: 'Claude Sonnet 3.7', thinking: true },
    { id: 'meta-llama/llama-3-8b', name: 'Llama 3 8B', thinking: false }
  ];
  catalogCache.ollama = [
    { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', thinking: true },
    { id: 'llama3:8b', name: 'Llama 3 8B', thinking: false },
    { id: 'mistral:7b', name: 'Mistral 7B' }
  ];
});

test('AVAILABLE_COMMANDS содержит базовый список команд', () => {
  assert.ok(Array.isArray(AVAILABLE_COMMANDS));
  assert.strictEqual(AVAILABLE_COMMANDS.length, 10);
  const cmds = AVAILABLE_COMMANDS.map(c => c.cmd);
  assert.ok(cmds.includes('/update'));
  assert.ok(cmds.includes('/model'));
  assert.ok(cmds.includes('/effort'));
  assert.ok(cmds.includes('/login'));
  assert.ok(cmds.includes('/clear'));
  assert.ok(cmds.includes('/context'));
  assert.ok(cmds.includes('/usage'));
  assert.ok(cmds.includes('/theme'));
  assert.ok(cmds.includes('/help'));
  assert.ok(cmds.includes('/exit'));
});

test('openrouter: есть /login, /usage, /effort', () => {
  const session = { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' };
  const commands = commandsFor(session);
  const cmds = commands.map(c => c.cmd);

  assert.ok(cmds.includes('/login'), 'Должна быть команда /login');
  assert.ok(cmds.includes('/usage'), 'Должна быть команда /usage');
  assert.ok(cmds.includes('/effort'), 'Должна быть команда /effort');

  // Для модели OpenRouter без явного поля thinking (undefined) /effort также показывается
  const autoSession = { provider: 'openrouter', model: 'openrouter/auto' };
  const autoCmds = commandsFor(autoSession).map(c => c.cmd);
  assert.ok(autoCmds.includes('/effort'), '/effort должен показываться, если thinking не false');

  // Для модели OpenRouter с thinking: false /effort скрывается
  const noThinkSession = { provider: 'openrouter', model: 'meta-llama/llama-3-8b' };
  const noThinkCmds = commandsFor(noThinkSession).map(c => c.cmd);
  assert.ok(noThinkCmds.includes('/login'));
  assert.ok(noThinkCmds.includes('/usage'));
  assert.strictEqual(noThinkCmds.includes('/effort'), false, '/effort не должен показываться при thinking: false');
});

test('ollama + модель с thinking: true: нет /login, /usage; есть /effort', () => {
  const session = { provider: 'ollama', model: 'deepseek-r1:8b' };
  const commands = commandsFor(session);
  const cmds = commands.map(c => c.cmd);

  assert.strictEqual(cmds.includes('/login'), false, 'Для Ollama не должно быть /login');
  assert.strictEqual(cmds.includes('/usage'), false, 'Для Ollama не должно быть /usage');
  assert.ok(cmds.includes('/effort'), 'Для модели Ollama с thinking: true должен быть /effort');
  assert.ok(cmds.includes('/model'));
  assert.ok(cmds.includes('/clear'));
  assert.ok(cmds.includes('/context'));
  assert.ok(cmds.includes('/theme'));
  assert.ok(cmds.includes('/help'));
  assert.ok(cmds.includes('/exit'));
});

test('ollama + модель с thinking: false: нет /effort', () => {
  const session = { provider: 'ollama', model: 'llama3:8b' };
  const commands = commandsFor(session);
  const cmds = commands.map(c => c.cmd);

  assert.strictEqual(cmds.includes('/login'), false);
  assert.strictEqual(cmds.includes('/usage'), false);
  assert.strictEqual(cmds.includes('/effort'), false, 'Для модели Ollama с thinking: false не должно быть /effort');

  // Модель без поля thinking (undefined) у Ollama также не должна иметь /effort
  const mistralSession = { provider: 'ollama', model: 'mistral:7b' };
  const mistralCmds = commandsFor(mistralSession).map(c => c.cmd);
  assert.strictEqual(mistralCmds.includes('/effort'), false, 'Для модели Ollama без thinking не должно быть /effort');
});

test('helpLines(session) для ollama не содержит /usage', () => {
  const session = { provider: 'ollama', model: 'deepseek-r1:8b' };
  const lines = helpLines(session);
  const text = lines.join('\n');

  assert.strictEqual(text.includes('/usage'), false, 'helpLines для ollama не должен содержать /usage');
  assert.strictEqual(text.includes('/login'), false, 'helpLines для ollama не должен содержать /login');
  assert.ok(text.includes('/effort'), 'helpLines для ollama с thinking: true должен содержать /effort');
  assert.ok(text.includes('⚡ Доступные слеш-команды:'));

  const orLines = helpLines({ provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' });
  const orText = orLines.join('\n');
  assert.ok(orText.includes('/usage'), 'helpLines для openrouter должен содержать /usage');
  assert.ok(orText.includes('/login'), 'helpLines для openrouter должен содержать /login');
});
