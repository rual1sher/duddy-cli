import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-usage-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 500 });

after(() => {
  globalThis.fetch = originalFetch;
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

const {
  recordRequest,
  recordQuotaHit,
  readLimits,
  writeLimits,
  parseRateHeaders,
  parseQuotaError
} = await import('../src/models/limits.js');

const {
  usageLines,
  contextLines,
  openRouterLimitLines
} = await import('../src/session-actions.js');

const {
  catalogCache,
  clearCatalogCache
} = await import('../src/models/catalog.js');

beforeEach(() => {
  const duddyDir = path.join(tmpHome, '.config', 'duddy');
  try {
    fs.rmSync(path.join(duddyDir, 'model-limits.json'), { force: true });
  } catch {}
  try {
    fs.rmSync(path.join(duddyDir, 'config.json'), { force: true });
  } catch {}
});

function createSession(overrides = {}) {
  return {
    provider: 'google',
    model: 'gemini-x',
    apiKey: 'k',
    contextLength: 1000,
    messages: [{ role: 'user', content: 'a' }],
    lastUsage: { total_tokens: 100 },
    modelUsage: { 'gemini-x': { totalTokens: 500 } },
    totalTokens: 1500,
    ...overrides
  };
}

test('1. recordRequest дважды: requests 2, tokens сумма; затем запись day 2000-01-01 и requests 1', () => {
  recordRequest('google', 'gemini-x', { total_tokens: 100 });
  recordRequest('google', 'gemini-x', { total_tokens: 250 });

  let limits = readLimits();
  assert.strictEqual(limits.models['google:gemini-x'].requests, 2);
  assert.strictEqual(limits.models['google:gemini-x'].tokens, 350);

  writeLimits({
    models: {
      'google:gemini-x': {
        day: '2000-01-01',
        requests: 9,
        tokens: 900
      }
    }
  });

  recordRequest('google', 'gemini-x', { total_tokens: 50 });
  limits = readLimits();
  assert.strictEqual(limits.models['google:gemini-x'].requests, 1);
  assert.strictEqual(limits.models['google:gemini-x'].tokens, 50);
});

test('2. recordRequest с rateLimits сохраняет rate с полем at, а следующий вызов с rateLimits null старый rate не стирает', () => {
  recordRequest('google', 'gemini-x', { total_tokens: 10 }, {
    limitRequests: 100,
    remainingRequests: 95
  });

  let limits = readLimits();
  const rate = limits.models['google:gemini-x']?.rate;
  assert.ok(rate);
  assert.strictEqual(typeof rate.at, 'number');
  assert.strictEqual(rate.limitRequests, 100);
  assert.strictEqual(rate.remainingRequests, 95);
  const originalAt = rate.at;

  recordRequest('google', 'gemini-x', { total_tokens: 20 }, null);
  limits = readLimits();
  const updatedRate = limits.models['google:gemini-x']?.rate;
  assert.ok(updatedRate);
  assert.strictEqual(updatedRate.limitRequests, 100);
  assert.strictEqual(updatedRate.remainingRequests, 95);
  assert.strictEqual(updatedRate.at, originalAt);
});

test('3. recordQuotaHit не стирает requests', () => {
  recordRequest('google', 'gemini-x', { total_tokens: 50 });
  let limits = readLimits();
  assert.strictEqual(limits.models['google:gemini-x'].requests, 1);

  recordQuotaHit('google', 'gemini-x', new Error('Quota exceeded'));
  limits = readLimits();
  assert.strictEqual(limits.models['google:gemini-x'].requests, 1);
  assert.ok(limits.models['google:gemini-x'].hit);
});

test('4. parseRateHeaders: различные заголовки лимитов и null для нечисловых/пустых', () => {
  const h1 = new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '80'
  });
  assert.deepStrictEqual(parseRateHeaders(h1), {
    limitRequests: 100,
    remainingRequests: 80,
    limitTokens: null,
    remainingTokens: null
  });

  const h2 = new Headers({
    'x-ratelimit-limit': '50',
    'x-ratelimit-remaining': '40'
  });
  assert.deepStrictEqual(parseRateHeaders(h2), {
    limitRequests: 50,
    remainingRequests: 40,
    limitTokens: null,
    remainingTokens: null
  });

  const h3 = new Headers({
    'x-ratelimit-limit': 'not-a-number',
    'x-ratelimit-remaining': '40'
  });
  assert.deepStrictEqual(parseRateHeaders(h3), {
    limitRequests: null,
    remainingRequests: 40,
    limitTokens: null,
    remainingTokens: null
  });

  const h4 = new Headers();
  assert.strictEqual(parseRateHeaders(h4), null);
  assert.strictEqual(parseRateHeaders(undefined), null);
});

test('5. parseQuotaError на сообщении Google', () => {
  const err = new Error(
    'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash\nPlease retry in 18.5s.'
  );
  assert.deepStrictEqual(parseQuotaError(err), {
    limit: 5,
    metric: 'generate_content_free_tier_requests',
    retryAfterSec: 18.5
  });
});

test('6. parseQuotaError на ошибке с метаданными заголовков', () => {
  const err = {
    message: 'Rate limit exceeded: free-models-per-day. Add 10 credits',
    error: {
      metadata: {
        headers: {
          'X-RateLimit-Limit': '50'
        }
      }
    }
  };
  assert.deepStrictEqual(parseQuotaError(err), {
    limit: 50,
    metric: 'free-models-per-day',
    retryAfterSec: null
  });
});

test('7. usageLines: записаны gemini-x и gemini-y', async () => {
  recordRequest('google', 'gemini-x', { total_tokens: 100 });
  recordRequest('google', 'gemini-y', { total_tokens: 50 });

  const session = createSession();
  const lines = await usageLines(session);
  const text = lines.join('\n');

  const activePos = text.indexOf('Активная модель: gemini-x');
  const othersPos = text.indexOf('Остальные модели');

  assert.ok(activePos !== -1, 'Должна присутствовать строка активной модели');
  assert.ok(othersPos !== -1, 'Должна присутствовать секция "Остальные модели"');
  assert.ok(activePos < othersPos, 'Позиция "Активная модель: gemini-x" должна быть меньше позиции "Остальные модели"');
  assert.ok(text.includes('gemini-y  запросов 1'), 'Должна содержать "gemini-y  запросов 1"');

  const lowerBlock = text.slice(othersPos);
  assert.strictEqual(lowerBlock.includes('gemini-x'), false, 'Нижний блок не должен содержать gemini-x');
  assert.strictEqual(text.includes('Окно'), false, 'В отчёте не должно быть слова "Окно"');
});

test('8. usageLines: модель x/y:free провайдера openrouter с записью', async () => {
  recordRequest('openrouter', 'x/y:free', { total_tokens: 10 });

  const session = createSession({
    provider: 'openrouter',
    model: 'a/b',
    apiKey: 'sk-or-test-key'
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('x/y:free  запросов 1'), 'Отчёт должен содержать "x/y:free  запросов 1"');
});

test('9. usageLines без данных и с единственным провайдером не содержит "Остальные модели"', async () => {
  clearCatalogCache();
  const session = createSession();
  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.strictEqual(text.includes('Остальные модели'), false);
});

test('10. usageLines с catalogCache.google', async () => {
  try {
    catalogCache.google = [
      { id: 'gemini-x' },
      { id: 'gemini-y' },
      { id: 'gemini-z' },
      { id: 'gemini-off', unavailable: 'plan' }
    ];
    recordRequest('google', 'gemini-y', { total_tokens: 10 });

    const session = createSession();
    const lines = await usageLines(session);
    const text = lines.join('\n');
    assert.ok(text.includes('Ещё моделей: 1,'), 'Отчёт должен содержать "Ещё моделей: 1,"');
  } finally {
    clearCatalogCache();
  }
});

test('11. openRouterLimitLines проверка условий баланса и расходов за день', () => {
  const withoutLimit = openRouterLimitLines({ usage_daily: 1.5 }).join('\n');
  assert.ok(withoutLimit.includes('День'), 'Должен содержать "День"');
  assert.strictEqual(withoutLimit.includes('Баланс'), false, 'Не должен содержать "Баланс"');

  const withLimit = openRouterLimitLines({ limit: 10, usage: 1 }).join('\n');
  assert.ok(withLimit.includes('Баланс'), 'Должен содержать "Баланс"');
});

test('12. contextLines: проверка ходов, токенов и отсутствия Лимит', async () => {
  const session = createSession();
  const lines = await contextLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('из 10 ходов'), 'Должно содержать "из 10 ходов"');
  assert.ok(text.includes('100 из 1'), 'Должно содержать "100 из 1"');
  assert.strictEqual(text.includes('Лимит'), false, 'Не должно содержать подстроку "Лимит"');
});

test('13. contextLines без lastUsage содержит "Данных пока нет"', async () => {
  const session = createSession({ lastUsage: null });
  const lines = await contextLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('Данных пока нет'), 'Должно содержать "Данных пока нет"');
});

test('14. usageLines, активная модель gemini-x: writeLimits с hit { limit: 5, metric: \'m\', at: Date.now() - 25 * 60 * 60 * 1000 } у \'google:gemini-x\'', async () => {
  const session = createSession();

  writeLimits({
    models: {
      'google:gemini-x': {
        hit: { limit: 5, metric: 'm', at: Date.now() - 25 * 60 * 60 * 1000 }
      }
    }
  });

  let lines = await usageLines(session);
  let text = lines.join('\n');
  assert.strictEqual(text.includes('Отказ 429'), false);

  writeLimits({
    models: {
      'google:gemini-x': {
        hit: { limit: 5, metric: 'm', at: Date.now() - 60000 }
      }
    }
  });

  lines = await usageLines(session);
  text = lines.join('\n');
  assert.ok(text.includes('Отказ 429'));
});

test('15. usageLines, строка другой модели: \'google:gemini-y\' с hit at: Date.now() - 25 * 60 * 60 * 1000 и day \'2000-01-01\'', async () => {
  const session = createSession();

  writeLimits({
    models: {
      'google:gemini-y': {
        day: '2000-01-01',
        hit: { limit: 5, metric: 'm', at: Date.now() - 25 * 60 * 60 * 1000 }
      }
    }
  });

  let lines = await usageLines(session);
  let text = lines.join('\n');
  assert.strictEqual(text.includes('gemini-y'), false);

  writeLimits({
    models: {
      'google:gemini-y': {
        day: '2000-01-01',
        hit: { limit: 5, metric: 'm', at: Date.now() - 60000 }
      }
    }
  });

  lines = await usageLines(session);
  text = lines.join('\n');
  assert.ok(text.includes('gemini-y'));
  assert.ok(text.includes('отказ 429 в'));
});

test('16. usageLines: \'google:gemini-y\' с day \'2000-01-01\', requests 9, без hit: в отчёте нет \'gemini-y\'', async () => {
  const session = createSession();

  writeLimits({
    models: {
      'google:gemini-y': {
        day: '2000-01-01',
        requests: 9
      }
    }
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.strictEqual(text.includes('gemini-y'), false);
});

test('17. streamChatCompletion из src/llm/stream.js возвращает rateLimits из заголовков ответа', async () => {
  const { streamChatCompletion } = await import('../src/llm/stream.js');
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-ratelimit-limit-requests': '60',
        'x-ratelimit-remaining-requests': '59'
      }
    });

  try {
    const result = await streamChatCompletion({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'a' }]
    });

    assert.strictEqual(result.rateLimits.limitRequests, 60);
    assert.strictEqual(result.rateLimits.remainingRequests, 59);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('18. runAgentTurn из src/agent.js вызывает events.onRequestDone с rateLimits и usage, а файл model-limits.json сам не создаёт', async () => {
  const { runAgentTurn } = await import('../src/agent.js');
  const { limitsFile } = await import('../src/models/limits.js');

  const prevFetch = globalThis.fetch;
  const originalStateHome = process.env.XDG_STATE_HOME;
  const testStateHome = path.join(tmpHome, 'state');
  fs.mkdirSync(testStateHome, { recursive: true });
  process.env.XDG_STATE_HOME = testStateHome;

  globalThis.fetch = async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
      {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-remaining-requests': '59'
        }
      }
    );

  const calls = [];
  try {
    await runAgentTurn({
      session: { provider: 'openrouter', apiKey: 'k', model: 'm' },
      messages: [{ role: 'user', content: 'a' }],
      toolCtx: { autoApprove: false, canPrompt: false },
      events: { onRequestDone: info => calls.push(info) }
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].usage.total_tokens, 2);
    assert.strictEqual(calls[0].rateLimits.limitRequests, 60);
    assert.strictEqual(fs.existsSync(limitsFile()), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (originalStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalStateHome;
    }
  }
});
