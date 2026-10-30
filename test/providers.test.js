import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProviderForModel, getProviderKey } from '../src/providers.js';

test('detectProviderForModel определяет провайдера по идентификатору модели', () => {
  assert.strictEqual(detectProviderForModel('grok-4.7'), 'xai');
  assert.strictEqual(detectProviderForModel('x-ai/grok-4'), 'openrouter');
  assert.strictEqual(detectProviderForModel('gemini-3.5-flash'), 'google');
  assert.strictEqual(detectProviderForModel('openrouter/free'), 'openrouter');
});

test('getProviderKey для xai возвращает ключ из конфига или env', () => {
  const origEnv = process.env.XAI_API_KEY;
  try {
    delete process.env.XAI_API_KEY;
    assert.strictEqual(getProviderKey('xai', { xaiApiKey: 'k' }), 'k');

    process.env.XAI_API_KEY = 'env-xai-key';
    assert.strictEqual(getProviderKey('xai', { xaiApiKey: 'k' }), 'env-xai-key');
  } finally {
    if (origEnv !== undefined) {
      process.env.XAI_API_KEY = origEnv;
    } else {
      delete process.env.XAI_API_KEY;
    }
  }
});
