import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта, чтобы config.js взял временный путь
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-warmup-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

const originalFetch = globalThis.fetch;

after(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

const { warmupLocalModel } = await import('../src/llm/warmup.js');
const { clearCatalogCache } = await import('../src/models/catalog.js');

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCatalogCache('ollama');
});

test('для provider ollama делается ровно один POST на .../chat/completions с max_tokens: 1 и system-сообщением', async () => {
  let postCount = 0;
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody = null;

  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    postCount++;
    capturedUrl = urlStr;
    capturedMethod = init?.method || 'GET';
    capturedBody = JSON.parse(init?.body || '{}');

    return new Response(JSON.stringify({
      id: 'warmup-1',
      choices: [{ message: { role: 'assistant', content: '' } }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const session = {
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'llama3.2:3b',
    systemPrompt: 'Default system prompt',
    systemPromptLean: 'Lean system prompt'
  };

  const result = await warmupLocalModel(session, { mode: 'default' });

  assert.strictEqual(result, true);
  assert.strictEqual(postCount, 1);
  assert.strictEqual(capturedMethod, 'POST');
  assert.ok(capturedUrl.includes('/chat/completions'), `URL ${capturedUrl} должен содержать /chat/completions`);
  assert.strictEqual(capturedBody.max_tokens, 1);
  assert.strictEqual(capturedBody.stream, false);
  assert.ok(Array.isArray(capturedBody.messages));
  const sysMsg = capturedBody.messages.find(m => m.role === 'system');
  assert.ok(sysMsg, 'Системное сообщение должно присутствовать');
  assert.strictEqual(sysMsg.content, 'Lean system prompt');
});

test('для provider openrouter запросов нет и возвращается false', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response('{}', { status: 200 });
  };

  const session = {
    provider: 'openrouter',
    apiKey: 'sk-or-test',
    model: 'openai/gpt-4o',
    systemPrompt: 'System prompt'
  };

  const result = await warmupLocalModel(session, { mode: 'default' });

  assert.strictEqual(result, false);
  assert.strictEqual(callCount, 0);
});

test('ошибка fetch глушится и не выбрасывается наружу (возвращает false)', async () => {
  globalThis.fetch = async () => {
    throw new Error('Connection refused: http://localhost:11434');
  };

  const session = {
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'llama3.2:3b',
    systemPrompt: 'System prompt'
  };

  const result = await warmupLocalModel(session, { mode: 'default' });
  assert.strictEqual(result, false);
});

test('при пустом каталоге прогрев догружает capabilities и выставляет reasoning_effort: none', async () => {
  clearCatalogCache('ollama');
  let capturedBody = null;

  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/api/tags')) {
      return new Response(JSON.stringify({
        models: [
          {
            name: 'deepseek-r1:8b',
            capabilities: ['completion', 'tools', 'thinking']
          }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (urlStr.includes('/chat/completions')) {
      capturedBody = JSON.parse(init?.body || '{}');
      return new Response(JSON.stringify({
        id: 'warmup-1',
        choices: [{ message: { role: 'assistant', content: '' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('{}', { status: 404 });
  };

  const session = {
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'deepseek-r1:8b',
    systemPrompt: 'System prompt'
  };

  const result = await warmupLocalModel(session, { mode: 'default' });

  assert.strictEqual(result, true);
  assert.ok(capturedBody, 'Запрос к /chat/completions должен быть выполнен');
  assert.strictEqual(capturedBody.reasoning_effort, 'none');
});
