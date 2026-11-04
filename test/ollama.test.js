import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaHost, getProviderKey, PROVIDERS } from '../src/providers.js';
import { fetchOllamaModels } from '../src/models/ollama.js';
import { getModelContextLength } from '../src/llm/modelInfo.js';
import { errorHint } from '../src/errors.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('ollamaHost нормализует OLLAMA_HOST как сама Ollama', () => {
  assert.equal(ollamaHost(''), 'http://localhost:11434');
  assert.equal(ollamaHost('localhost'), 'http://localhost:11434');
  assert.equal(ollamaHost('0.0.0.0'), 'http://127.0.0.1:11434');
  assert.equal(ollamaHost('0.0.0.0:11434'), 'http://127.0.0.1:11434');
  assert.equal(ollamaHost('192.168.1.5:8080'), 'http://192.168.1.5:8080');
  assert.equal(ollamaHost('http://host:1234/'), 'http://host:1234');
  assert.equal(ollamaHost('https://example.com/ollama/'), 'https://example.com/ollama');
});

test('Ollama не требует ключа: getProviderKey возвращает непустую заглушку', () => {
  assert.equal(PROVIDERS.ollama.local, true);
  assert.ok(getProviderKey('ollama', {}));
});

test('fetchOllamaModels разбирает возможности моделей', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith('/api/tags'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: 'qwen3:8b',
            details: { parameter_size: '8.2B', context_length: 40960 },
            capabilities: ['completion', 'tools', 'thinking']
          },
          { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
          { name: 'gemma3:4b', capabilities: ['completion', 'vision'] },
          { name: 'old-model:latest', details: {} }
        ]
      })
    };
  };

  const models = await fetchOllamaModels();
  assert.deepEqual(models.map(m => m.id), ['gemma3:4b', 'old-model:latest', 'qwen3:8b']);

  const qwen = models.find(m => m.id === 'qwen3:8b');
  assert.equal(qwen.provider, 'ollama');
  assert.equal(qwen.name, 'qwen3:8b · 8.2B');
  assert.equal(qwen.contextLength, 40960);
  assert.equal(qwen.thinking, true);
  assert.equal(qwen.unavailable, null);

  const gemma = models.find(m => m.id === 'gemma3:4b');
  assert.equal(gemma.vision, true);
  assert.equal(gemma.thinking, false);
  assert.equal(gemma.unavailable, 'notools');

  // Старая Ollama без capabilities: модель считается подходящей, о рассуждениях ничего не известно
  const old = models.find(m => m.id === 'old-model:latest');
  assert.equal(old.unavailable, null);
  assert.equal(old.thinking, undefined);
});

test('fetchOllamaModels бросает понятную ошибку, если Ollama не запущена', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(fetchOllamaModels(), /Ollama не запущена/);
});

test('getModelContextLength берёт окно контекста Ollama из /api/show', async () => {
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).endsWith('/api/show'));
    assert.equal(JSON.parse(init.body).model, 'test-ctx:1b');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 }
      })
    };
  };
  assert.equal(await getModelContextLength('test-ctx:1b', 'ollama', 'ollama'), 32768);
});

test('errorHint подсказывает запустить Ollama при отказе соединения', () => {
  const err = Object.assign(new Error('Connection error.'), {
    cause: { code: 'ECONNREFUSED' }
  });
  assert.match(errorHint(err, { provider: 'ollama', apiKey: 'ollama' }), /ollama serve/);
});
