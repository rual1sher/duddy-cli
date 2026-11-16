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
  openRouterLimitLines
} = await import('../src/reports/usageReport.js');

const {
  contextLines
} = await import('../src/reports/contextReport.js');

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
    provider: 'openrouter',
    model: 'model-x',
    apiKey: 'k',
    contextLength: 1000,
    messages: [{ role: 'user', content: 'a' }],
    lastUsage: { total_tokens: 100 },
    modelUsage: { 'model-x': { totalTokens: 500 } },
    totalTokens: 1500,
    ...overrides
  };
}

test('1. recordRequest дважды: requests 2, tokens сумма; затем запись day 2000-01-01 и requests 1', () => {
  recordRequest('openrouter', 'model-x', { total_tokens: 100 });
  recordRequest('openrouter', 'model-x', { total_tokens: 250 });

  let limits = readLimits();
  assert.strictEqual(limits.models['openrouter:model-x'].requests, 2);
  assert.strictEqual(limits.models['openrouter:model-x'].tokens, 350);

  writeLimits({
    models: {
      'openrouter:model-x': {
        day: '2000-01-01',
        requests: 9,
        tokens: 900
      }
    }
  });

  recordRequest('openrouter', 'model-x', { total_tokens: 50 });
  limits = readLimits();
  assert.strictEqual(limits.models['openrouter:model-x'].requests, 1);
  assert.strictEqual(limits.models['openrouter:model-x'].tokens, 50);
});

test('2. recordRequest с rateLimits сохраняет rate с полем at, а следующий вызов с rateLimits null старый rate не стирает', () => {
  recordRequest('openrouter', 'model-x', { total_tokens: 10 }, {
    limitRequests: 100,
    remainingRequests: 95
  });

  let limits = readLimits();
  const rate = limits.models['openrouter:model-x']?.rate;
  assert.ok(rate);
  assert.strictEqual(typeof rate.at, 'number');
  assert.strictEqual(rate.limitRequests, 100);
  assert.strictEqual(rate.remainingRequests, 95);
  const originalAt = rate.at;

  recordRequest('openrouter', 'model-x', { total_tokens: 20 }, null);
  limits = readLimits();
  const updatedRate = limits.models['openrouter:model-x']?.rate;
  assert.ok(updatedRate);
  assert.strictEqual(updatedRate.limitRequests, 100);
  assert.strictEqual(updatedRate.remainingRequests, 95);
  assert.strictEqual(updatedRate.at, originalAt);
});

test('3. recordQuotaHit не стирает requests', () => {
  recordRequest('openrouter', 'model-x', { total_tokens: 50 });
  let limits = readLimits();
  assert.strictEqual(limits.models['openrouter:model-x'].requests, 1);

  recordQuotaHit('openrouter', 'model-x', new Error('Quota exceeded'));
  limits = readLimits();
  assert.strictEqual(limits.models['openrouter:model-x'].requests, 1);
  assert.ok(limits.models['openrouter:model-x'].hit);
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

test('7. usageLines: активная модель с записью за сегодня и отсутствие блока "Остальные модели"', async () => {
  recordRequest('openrouter', 'model-x', { total_tokens: 100 });
  recordRequest('openrouter', 'model-x', { total_tokens: 150 });
  recordRequest('openrouter', 'model-y', { total_tokens: 50 });

  const session = createSession({ apiKey: '' });
  const lines = await usageLines(session);
  const text = lines.join('\n');

  assert.ok(text.includes('📊 Лимиты · model-x'), 'Должен быть заголовок активной модели');
  assert.ok(
    text.includes('Эта модель через Duddy сегодня: 2 запроса · 250 токенов'),
    'Должна быть строка "Эта модель через Duddy сегодня: 2 запроса · 250 токенов"'
  );
  assert.strictEqual(text.includes('Остальные модели'), false, 'Блок "Остальные модели" не должен выводиться');
  assert.strictEqual(text.includes('model-y'), false, 'Другие модели не должны выводиться');
  assert.strictEqual(text.includes('Активная модель:'), false, 'Старая строка "Активная модель:" удалена');
  assert.strictEqual(text.includes('За сессию:'), false, 'Старая строка "За сессию:" удалена');
  assert.strictEqual(text.includes('Всего за сессию'), false, 'Старая строка "Всего за сессию" удалена');
});

test('8. usageLines: модель x/y:free другого запроса не выводится, а для a/b без записей "Эта модель через Duddy сегодня: запросов не было"', async () => {
  recordRequest('openrouter', 'x/y:free', { total_tokens: 10 });

  const session = createSession({
    provider: 'openrouter',
    model: 'a/b',
    apiKey: ''
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.strictEqual(text.includes('x/y:free'), false, 'Неактивная модель x/y:free не должна выводиться');
  assert.ok(text.includes('Эта модель через Duddy сегодня: запросов не было'), 'Должно содержать "Эта модель через Duddy сегодня: запросов не было"');
});

test('9. usageLines без данных: строка "Эта модель через Duddy сегодня: запросов не было" и нет "Остальные модели"', async () => {
  clearCatalogCache();
  const session = createSession({ apiKey: '' });
  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('Эта модель через Duddy сегодня: запросов не было'));
  assert.strictEqual(text.includes('Остальные модели'), false);
});

test('10. usageLines: freeDaily с remaining 0 -> "лимит исчерпан" и нет строки "Отказ 429"', async () => {
  writeLimits({
    models: {
      'openrouter:model-x': {
        hit: { limit: 50, metric: 'free-models-per-day', at: Date.now() - 60000 }
      }
    }
  });

  const session = createSession({
    apiKey: '',
    keyInfo: {
      free_model_daily_requests: {
        limit: 50,
        used: 50,
        remaining: 0
      }
    }
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('лимит исчерпан'), 'Должно содержать "лимит исчерпан"');
  assert.strictEqual(text.includes('Отказ 429'), false, 'Строка "Отказ 429" не должна выводиться при наличии шкалы freeDaily');
  assert.strictEqual(text.includes('Остальные модели'), false);
});

test('11. openRouterLimitLines: keyInfo.limit -> "Баланс:", monthly 0 -> нет "Потрачено", monthly > 0 -> "Потрачено:"', () => {
  const withoutMonthly = openRouterLimitLines({ usage_daily: 1.5, usage_monthly: 0 }).join('\n');
  assert.strictEqual(withoutMonthly.includes('Потрачено'), false, 'При monthly 0 строки "Потрачено" быть не должно');
  assert.strictEqual(withoutMonthly.includes('Баланс'), false, 'Без limit строки "Баланс" быть не должно');
  assert.strictEqual(withoutMonthly.includes('День:'), false, 'Старая строка "День:" удалена');

  const withMonthly = openRouterLimitLines({ usage_daily: 1.5, usage_monthly: 10.2 }).join('\n');
  assert.ok(
    withMonthly.includes('Потрачено: $1.50 сегодня · $10.20 за месяц'),
    'При monthly > 0 должна быть строка "Потрачено: $1.50 сегодня · $10.20 за месяц"'
  );

  const withLimit = openRouterLimitLines({ limit: 10, usage: 1 }).join('\n');
  assert.ok(withLimit.includes('Баланс:'), 'При limit должна присутствовать строка "Баланс:"');
});

test('12. contextLines: проверка токенов и отсутствия Лимит', async () => {
  const session = createSession();
  const lines = await contextLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('100 из 1'), 'Должно содержать "100 из 1"');
  assert.strictEqual(text.includes('Лимит'), false, 'Не должно содержать подстроку "Лимит"');
});

test('13. contextLines без lastUsage содержит "Данных пока нет"', async () => {
  const session = createSession({ lastUsage: null });
  const lines = await contextLines(session);
  const text = lines.join('\n');
  assert.ok(text.includes('Данных пока нет'), 'Должно содержать "Данных пока нет"');
});

test('14. usageLines, активная модель: freeDaily нет, hit за 24ч -> "Отказ 429", hit старше 24ч -> не выводится', async () => {
  const session = createSession({ apiKey: '' });

  writeLimits({
    models: {
      'openrouter:model-x': {
        hit: { limit: 5, metric: 'm', at: Date.now() - 25 * 60 * 60 * 1000 }
      }
    }
  });

  let lines = await usageLines(session);
  let text = lines.join('\n');
  assert.strictEqual(text.includes('Отказ 429'), false, 'Hit старше 24 часов не должен выводиться');

  writeLimits({
    models: {
      'openrouter:model-x': {
        hit: { limit: 5, metric: 'm', at: Date.now() - 60000 }
      }
    }
  });

  lines = await usageLines(session);
  text = lines.join('\n');
  assert.ok(text.includes('Отказ 429'), 'Hit за последние 24 часа должен выводиться');
});

test('15. usageLines: данные другой модели "openrouter:model-y" со свежим hit не выводятся в отчёт', async () => {
  const session = createSession({ apiKey: '' });

  writeLimits({
    models: {
      'openrouter:model-y': {
        day: '2000-01-01',
        hit: { limit: 5, metric: 'm', at: Date.now() - 60000 }
      }
    }
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.strictEqual(text.includes('model-y'), false);
  assert.strictEqual(text.includes('Остальные модели'), false);
});

test('16. usageLines: запросы другой модели "openrouter:model-y" за сегодня не выводятся в отчёт', async () => {
  const session = createSession({ apiKey: '' });
  const today = new Date().toISOString().slice(0, 10);

  writeLimits({
    models: {
      'openrouter:model-y': {
        day: today,
        requests: 9,
        tokens: 900
      }
    }
  });

  const lines = await usageLines(session);
  const text = lines.join('\n');
  assert.strictEqual(text.includes('model-y'), false);
  assert.strictEqual(text.includes('Остальные модели'), false);
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
  const { runAgentTurn } = await import('../src/agent/agent.js');
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

test('19. openRouterLimitLines: подсказка про $10 при исчерпании лимита < 1000 и отсутствие подсказки при лимите 1000', () => {
  const exhausted = openRouterLimitLines({
    free_model_daily_requests: { used: 53, limit: 50, remaining: 0 }
  }).join('\n');
  assert.ok(exhausted.includes('50 из 50'), 'Должна быть строка с "50 из 50"');
  assert.strictEqual(exhausted.includes('53'), false, 'Строка не должна содержать "53"');
  assert.ok(exhausted.includes('лимит исчерпан'), 'Должно содержать "лимит исчерпан"');
  assert.ok(
    exhausted.includes('после покупки $10 кредитов — 1000 запросов в день'),
    'Должна быть подсказка про $10'
  );

  const notExhausted = openRouterLimitLines({
    free_model_daily_requests: { used: 10, limit: 1000, remaining: 990 }
  }).join('\n');
  assert.strictEqual(
    notExhausted.includes('$10'),
    false,
    'При limit 1000 подсказки про $10 быть не должно'
  );
});
