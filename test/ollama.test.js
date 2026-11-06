import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaHost, getProviderKey, PROVIDERS } from '../src/providers.js';
import { fetchOllamaModels, fetchOllamaRuntimeContext, ollamaContextWarning } from '../src/models/ollama.js';
import { getModelContextLength } from '../src/llm/modelInfo.js';
import { errorHint } from '../src/errors.js';
import { runAgentTurn } from '../src/agent.js';

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

test('errorHint подсказывает увеличить контекст Ollama при превышении окна', () => {
  const err = Object.assign(
    new Error('400 request (8017 tokens) exceeds the available context size (4096 tokens), try increasing it'),
    { status: 400 }
  );
  assert.match(
    errorHint(err, { provider: 'ollama', apiKey: 'ollama' }),
    /OLLAMA_CONTEXT_LENGTH/
  );
});

test('fetchOllamaRuntimeContext возвращает context_length для совпавшей модели, null при отсутствии, другой модели или ошибке fetch', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith('/api/ps'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: 'llama3:8b', context_length: 4096 },
          { model: 'qwen2.5:7b', context_length: 32768 },
          { name: 'broken:1b', context_length: 0 },
          { name: 'neg:1b', context_length: -100 }
        ]
      })
    };
  };

  assert.equal(await fetchOllamaRuntimeContext('llama3:8b'), 4096);
  assert.equal(await fetchOllamaRuntimeContext('qwen2.5:7b'), 32768);
  assert.equal(await fetchOllamaRuntimeContext('missing:7b'), null);
  assert.equal(await fetchOllamaRuntimeContext('broken:1b'), null);
  assert.equal(await fetchOllamaRuntimeContext('neg:1b'), null);

  // Ошибка ответа сервера (!res.ok) -> null
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({})
  });
  assert.equal(await fetchOllamaRuntimeContext('llama3:8b'), null);

  // Исключение fetch -> null (never throw)
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  assert.equal(await fetchOllamaRuntimeContext('llama3:8b'), null);
});

test('ollamaContextWarning генерирует предупреждение при prompt_tokens >= 75% окна и null ниже', () => {
  const warn = ollamaContextWarning(4000, 4096);
  assert.match(warn, /Память модели почти заполнена: запрос занял 4000 из 4096 токенов/);
  assert.match(warn, /OLLAMA_CONTEXT_LENGTH=32768/);

  // Ровно 75%: 4096 * 0.75 = 3072 -> предупреждение
  assert.ok(ollamaContextWarning(3072, 4096));
  // 3071 < 3072 -> null
  assert.equal(ollamaContextWarning(3071, 4096), null);
  assert.equal(ollamaContextWarning(1000, 4096), null);
  assert.equal(ollamaContextWarning(null, 4096), null);
  assert.equal(ollamaContextWarning(4000, null), null);
  assert.equal(ollamaContextWarning(4000, 0), null);
});

test('runAgentTurn: предупреждение о заполнении контекста Ollama и кэширование /api/ps', async () => {
  const encoder = new TextEncoder();
  let psCallCount = 0;
  const warnings = [];

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/api/ps')) {
      psCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'test-ollama-model', context_length: 4096 }
          ]
        })
      };
    }

    if (urlStr.includes('/chat/completions')) {
      const stream = new ReadableStream({
        start(ctrl) {
          const chunk = {
            choices: [{ delta: { content: 'Привет!' } }],
            usage: { prompt_tokens: 3950, completion_tokens: 5, total_tokens: 3955 }
          };
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }

    throw new Error(`Unexpected fetch to ${urlStr}`);
  };

  const session = {
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'test-ollama-model',
    messages: []
  };

  // Шаг 1: prompt_tokens (3950) >= 4096 * 0.75 (3072) -> предупреждение выдано, contextLength установлен
  await runAgentTurn({
    session,
    messages: [{ role: 'user', content: 'hello' }],
    events: {
      onWarning: (w) => warnings.push(w)
    }
  });

  assert.equal(session.contextLength, 4096);
  assert.equal(psCallCount, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Память модели почти заполнена/);

  // Шаг 2: тот же запрос с той же моделью -> повторного запроса к /api/ps и повторного предупреждения нет
  await runAgentTurn({
    session,
    messages: [{ role: 'user', content: 'again' }],
    events: {
      onWarning: (w) => warnings.push(w)
    }
  });

  assert.equal(psCallCount, 1, 'Повторный вызов /api/ps не должен выполняться для той же модели');
  assert.equal(warnings.length, 1, 'Предупреждение не должно повторяться для той же модели в сессии');
});
