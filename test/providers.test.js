import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProviderForModel, getProviderKey } from '../src/providers.js';

test('detectProviderForModel определяет провайдера по идентификатору модели', () => {
  assert.strictEqual(detectProviderForModel('grok-4.7'), 'openrouter');
  assert.strictEqual(detectProviderForModel('x-ai/grok-4'), 'openrouter');
  assert.strictEqual(detectProviderForModel('gemini-3.5-flash'), 'openrouter');
  assert.strictEqual(detectProviderForModel('openrouter/free'), 'openrouter');
  assert.strictEqual(detectProviderForModel('ollama/llama3'), 'ollama');
});

test('getProviderKey для openrouter возвращает ключ из конфига или env', () => {
  const origEnv = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.strictEqual(getProviderKey('openrouter', { apiKey: 'k' }), 'k');

    process.env.OPENROUTER_API_KEY = 'env-openrouter-key';
    assert.strictEqual(getProviderKey('openrouter', { apiKey: 'k' }), 'env-openrouter-key');
  } finally {
    if (origEnv !== undefined) {
      process.env.OPENROUTER_API_KEY = origEnv;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  }
});
