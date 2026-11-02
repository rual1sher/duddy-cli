import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchXaiModels, validateXaiKey, describeXaiError } from '../src/models/xai.js';
import { fetchKeyInfo, getModelContextLength } from '../src/llm/modelInfo.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('fetchXaiModels фильтрует неподходящие модели и поднимает defaultModel на первое место', async () => {
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/language-models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { id: 'grok-beta', input_modalities: ['text'], output_modalities: ['text'] },
            { id: 'grok-4.7', input_modalities: ['text', 'image'], output_modalities: ['text'] },
            { id: 'grok-4.20-multi-agent-0309', input_modalities: ['text'], output_modalities: ['text'] },
            { id: 'grok-imagine-image', input_modalities: ['text'], output_modalities: ['image'] },
            { id: 'other-model-without-grok', input_modalities: ['text'], output_modalities: ['text'] },
            { id: 'grok-2', input_modalities: ['text'], output_modalities: ['text'] }
          ]
        })
      };
    }
    if (urlStr.includes('/v1/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'grok-4.7', context_length: 131072 },
            { id: 'grok-2', context_length: 32768 }
          ]
        })
      };
    }
    throw new Error(`Unexpected fetch URL: ${urlStr}`);
  };

  const models = await fetchXaiModels('valid-key');
  const ids = models.map(m => m.id);

  assert.ok(!ids.includes('grok-4.20-multi-agent-0309'));
  assert.ok(!ids.includes('grok-imagine-image'));
  assert.ok(!ids.includes('other-model-without-grok'));

  assert.strictEqual(models[0].id, 'grok-4.7');
  assert.strictEqual(models[0].contextLength, 131072);
  assert.strictEqual(models[0].vision, true);
});

test('fetchXaiModels выбрасывает понятную ошибку при статусе 401', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => ''
  });

  await assert.rejects(
    async () => fetchXaiModels('invalid-key'),
    { message: /не принял ключ/ }
  );
});

test('fetchXaiModels возвращает модели без contextLength, если запрос к /v1/models завершился с ошибкой', async () => {
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/language-models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { id: 'grok-4.7', input_modalities: ['text'], output_modalities: ['text'] }
          ]
        })
      };
    }
    if (urlStr.includes('/v1/models')) {
      throw new Error('Connection refused');
    }
    throw new Error(`Unexpected URL: ${urlStr}`);
  };

  const models = await fetchXaiModels('valid-key');
  assert.strictEqual(models.length, 1);
  assert.strictEqual(models[0].id, 'grok-4.7');
  assert.strictEqual(models[0].contextLength, undefined);
});

test('validateXaiKey выбрасывает ошибку при статусе 401', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => ''
  });

  await assert.rejects(
    async () => validateXaiKey('bad-key'),
    { message: /не принял ключ/ }
  );
});

test('fetchKeyInfo не вызывает fetch для провайдеров xai и google и возвращает null', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  const xaiRes = await fetchKeyInfo('some-key', 'xai');
  assert.strictEqual(xaiRes, null);

  const googleRes = await fetchKeyInfo('some-key', 'google');
  assert.strictEqual(googleRes, null);
});

test('getModelContextLength для xai запрашивает api.x.ai и не обращается к openrouter.ai', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    requestedUrls.push(urlStr);
    assert.strictEqual(opts?.headers?.Authorization, 'Bearer xai-test-key');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        context_length: 262144
      })
    };
  };

  const len = await getModelContextLength('grok-4.7-custom', 'xai', 'xai-test-key');
  assert.strictEqual(len, 262144);
  assert.strictEqual(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].startsWith('https://api.x.ai/v1/models/'));
  assert.ok(!requestedUrls.some(u => u.includes('openrouter.ai')));
});

test('describeXaiError: 400 и body с некорректным ключом формирует понятную ошибку', () => {
  const err = describeXaiError(400, '{"error":"Incorrect API key provided: xa***"}', 'some-key');
  assert.ok(err.includes('не принял ключ'));
  assert.ok(err.includes('Ответ xAI: Incorrect API key'));
});

test('describeXaiError: 403 и body без кредитов указывает на отсутствие средств', () => {
  const err = describeXaiError(403, '{"code":"x","error":"Your newly created team doesn\'t have any credits yet."}', 'some-key');
  assert.ok(err.includes('нет средств'));
});

test('describeXaiError: 403 и body Forbidden сообщает об ограничении доступа', () => {
  const err = describeXaiError(403, '{"error":"Forbidden"}', 'some-key');
  assert.ok(err.includes('запретил доступ'));
});

test('describeXaiError: 429 и 503 с пустым body', () => {
  const err429 = describeXaiError(429, '', 'some-key');
  assert.ok(err429.includes('Слишком много'));

  const err503 = describeXaiError(503, '', 'some-key');
  assert.ok(err503.includes('HTTP 503'));
  assert.ok(!err503.includes('Ответ xAI'));
});

test('describeXaiError: маскирует переданный ключ в причине ошибки', () => {
  const err = describeXaiError(400, 'bad xai-secret123 text', 'xai-secret123');
  assert.ok(!err.includes('xai-secret123'));
  assert.ok(err.includes('***'));
});

test('describeXaiError: длинное тело ответа обрезается и результат короче 400 символов', () => {
  const body = 'x'.repeat(500);
  const err = describeXaiError(500, body, 'some-key');
  assert.ok(err.length < 400);
});

test('validateXaiKey при 403 с кредитами отклоняет с сообщением, содержащим "нет средств"', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ code: 'x', error: "Your newly created team doesn't have any credits yet." })
  });

  await assert.rejects(
    async () => validateXaiKey('bad-key'),
    { message: /нет средств/ }
  );
});

test('describeXaiError маскирует ключ, попавший на границу обрезки текста', () => {
  const key = 'xai-secret-key-1234567890';
  const text = describeXaiError(403, 'x'.repeat(190) + key, key);
  assert.ok(!text.includes('xai-secret'), text);
});
