import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamWithRetry, isTransientError, rateLimitWaitMs } from '../src/llm/retry.js';

// Тесты используют минимальные delays, чтобы не ждать секунды

test('isTransientError: APIConnectionTimeoutError → временная', () => {
  const err = new Error('timeout');
  err.name = 'APIConnectionTimeoutError';
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: APIConnectionError → временная', () => {
  const err = new Error('connection error');
  err.name = 'APIConnectionError';
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: status 408 → временная', () => {
  const err = new Error('Request Timeout');
  err.status = 408;
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: status 500 → временная', () => {
  const err = new Error('Internal Server Error');
  err.status = 500;
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: status 503 → временная', () => {
  const err = new Error('Service Unavailable');
  err.status = 503;
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: status 520 → временная (Cloudflare)', () => {
  const err = new Error('Unknown Error');
  err.status = 520;
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: status 400 → не временная (клиентская ошибка)', () => {
  const err = new Error('Bad Request');
  err.status = 400;
  assert.strictEqual(isTransientError(err), false);
});

test('isTransientError: status 501 → не временная (Not Implemented)', () => {
  const err = new Error('Not Implemented');
  err.status = 501;
  assert.strictEqual(isTransientError(err), false);
});

test('isTransientError: AbortError → не временная', () => {
  const err = new Error('Request was aborted.');
  err.name = 'AbortError';
  assert.strictEqual(isTransientError(err), false);
});

test('isTransientError: ECONNRESET в сообщении → временная', () => {
  const err = new Error('ECONNRESET');
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: "fetch failed" → временная', () => {
  const err = new Error('fetch failed');
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: "socket hang up" → временная', () => {
  const err = new Error('socket hang up');
  assert.strictEqual(isTransientError(err), true);
});

test('isTransientError: обычная ошибка → не временная', () => {
  const err = new Error('some validation error');
  assert.strictEqual(isTransientError(err), false);
});

test('streamWithRetry: успех с первой попытки', async () => {
  let calls = 0;
  const result = await streamWithRetry(
    async () => {
      calls++;
      return 'ok';
    },
    { delays: [1] }
  );
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 1);
});

test('streamWithRetry: временная ошибка → повтор и успех', async () => {
  let calls = 0;
  const result = await streamWithRetry(
    async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('fetch failed');
        throw err;
      }
      return 'success after retry';
    },
    { delays: [1, 1, 1] }
  );
  assert.strictEqual(result, 'success after retry');
  assert.strictEqual(calls, 3);
});

test('streamWithRetry: 400 → нет повтора, ошибка пробрасывается', async () => {
  let calls = 0;
  await assert.rejects(
    async () => {
      await streamWithRetry(
        async () => {
          calls++;
          const err = new Error('Bad Request');
          err.status = 400;
          throw err;
        },
        { delays: [1, 1, 1] }
      );
    },
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
  assert.strictEqual(calls, 1);
});

test('streamWithRetry: canRetry() === false → нет повтора', async () => {
  let calls = 0;
  await assert.rejects(
    async () => {
      await streamWithRetry(
        async () => {
          calls++;
          const err = new Error('fetch failed');
          throw err;
        },
        { delays: [1, 1], canRetry: () => false }
      );
    },
    () => true
  );
  assert.strictEqual(calls, 1);
});

test('streamWithRetry: отмена во время паузы → AbortError', async () => {
  const ac = new AbortController();
  let calls = 0;

  // Сразу отменяем после первой ошибки: пауза прервётся
  const promise = streamWithRetry(
    async () => {
      calls++;
      if (calls === 1) {
        // Планируем abort через 5 мс, а пауза 50 мс
        setTimeout(() => ac.abort(), 5);
        const err = new Error('fetch failed');
        throw err;
      }
      return 'should not reach';
    },
    { signal: ac.signal, delays: [50, 50] }
  );

  await assert.rejects(
    async () => promise,
    (err) => {
      assert.strictEqual(err.name, 'AbortError');
      return true;
    }
  );
  // Второго вызова не было — отмена произошла во время паузы
  assert.strictEqual(calls, 1);
});

test('streamWithRetry: не более delays.length повторов', async () => {
  let calls = 0;
  await assert.rejects(
    async () => {
      await streamWithRetry(
        async () => {
          calls++;
          const err = new Error('fetch failed');
          throw err;
        },
        { delays: [1, 1] }
      );
    },
    () => true
  );
  // 1 первоначальный + 2 повтора = 3
  assert.strictEqual(calls, 3);
});

test('streamWithRetry: снимает обработчик abort с signal после срабатывания таймера', async () => {
  const ac = new AbortController();
  let calls = 0;
  await streamWithRetry(
    async () => {
      calls++;
      if (calls === 1) {
        throw new Error('fetch failed');
      }
      return 'done';
    },
    { signal: ac.signal, delays: [10] }
  );
  assert.strictEqual(calls, 2);
  const { getEventListeners } = await import('node:events');
  const listeners = getEventListeners(ac.signal, 'abort');
  assert.strictEqual(listeners.length, 0);
});

test('streamWithRetry: 429 free-models-per-min → повтор и успех, onWait вызван с rateLimited: true', async () => {
  let calls = 0;
  const onWaitCalls = [];
  const result = await streamWithRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const err = new Error('Rate limit exceeded: free-models-per-min.');
        err.status = 429;
        err.error = {
          metadata: {
            headers: {
              'X-RateLimit-Reset': String(Date.now() + 50)
            }
          }
        };
        throw err;
      }
      return 'success after rate limit';
    },
    {
      delays: [100],
      rateLimitMinMs: 0,
      onWait: (info) => onWaitCalls.push(info)
    }
  );

  assert.strictEqual(result, 'success after rate limit');
  assert.strictEqual(calls, 2);
  assert.strictEqual(onWaitCalls.length, 1);
  assert.strictEqual(onWaitCalls[0].rateLimited, true);
  assert.ok(typeof onWaitCalls[0].ms === 'number');
});

test('streamWithRetry: 429 free-models-per-day → без повтора, ошибка проброшена', async () => {
  let calls = 0;
  await assert.rejects(
    async () => {
      await streamWithRetry(
        async () => {
          calls++;
          const err = new Error('Rate limit exceeded: free-models-per-day.');
          err.status = 429;
          throw err;
        },
        { delays: [1, 1], rateLimitMinMs: 0 }
      );
    },
    (err) => {
      assert.strictEqual(err.status, 429);
      return true;
    }
  );
  assert.strictEqual(calls, 1);
});

test(
  'rateLimitWaitMs: ms epoch, секунды epoch, секунды от сейчас, retryAfterSec, ограничение maxMs, null для per-day и 500',
  () => {
    // 1. null для per-day и 500
    const perDayErr = new Error('Rate limit exceeded: free-models-per-day.');
    perDayErr.status = 429;
    assert.strictEqual(rateLimitWaitMs(perDayErr), null);

    const status500Err = new Error('Rate limit exceeded: free-models-per-min.');
    status500Err.status = 500;
    assert.strictEqual(rateLimitWaitMs(status500Err), null);

    // 2. ms epoch (значение > 1e12) -> value - Date.now() + 500
    const now = Date.now();
    const msEpochErr = {
      status: 429,
      message: 'Rate limit exceeded: free-models-per-min.',
      error: {
        metadata: {
          headers: {
            'X-RateLimit-Reset': String(now + 3000)
          }
        }
      }
    };
    const waitMsEpoch = rateLimitWaitMs(msEpochErr, { minMs: 0 });
    assert.ok(waitMsEpoch >= 3400 && waitMsEpoch <= 3600, `waitMsEpoch (${waitMsEpoch}) должен быть около 3500`);

    // 3. секунды epoch (значение > 1e9) -> value * 1000 - Date.now() + 500
    const nowSec = Math.floor(now / 1000);
    const secEpochErr = {
      status: 429,
      message: 'Rate limit exceeded: free-models-per-min.',
      error: {
        metadata: {
          headers: {
            'x-ratelimit-reset': String(nowSec + 10)
          }
        }
      }
    };
    const waitSecEpoch = rateLimitWaitMs(secEpochErr, { minMs: 0 });
    assert.ok(waitSecEpoch >= 9000 && waitSecEpoch <= 11000, `waitSecEpoch (${waitSecEpoch}) должен быть около 10500`);

    // 4. секунды от текущего момента (значение <= 1e9) -> value * 1000
    const secFromNowErr = {
      status: 429,
      message: 'Rate limit exceeded: free-models-per-min.',
      error: {
        metadata: {
          headers: {
            'X-RateLimit-Reset': '15'
          }
        }
      }
    };
    assert.strictEqual(rateLimitWaitMs(secFromNowErr), 15000);

    // 5. retryAfterSec
    const retryAfterErr = {
      status: 429,
      message: 'Rate limit exceeded: free-models-per-min. Please retry in 12s.'
    };
    assert.strictEqual(rateLimitWaitMs(retryAfterErr), 12000);

    // 6. ограничение maxMs
    const maxMsErr = {
      status: 429,
      message: 'Rate limit exceeded: free-models-per-min.',
      error: {
        metadata: {
          headers: {
            'X-RateLimit-Reset': '100'
          }
        }
      }
    };
    assert.strictEqual(rateLimitWaitMs(maxMsErr, { maxMs: 65000 }), 65000);
    assert.strictEqual(rateLimitWaitMs(maxMsErr, { maxMs: 5000 }), 5000);
  }
);

test('isTransientError: status 429 free-models-per-min → временная, free-models-per-day → не временная', () => {
  const minErr = new Error('Rate limit exceeded: free-models-per-min.');
  minErr.status = 429;
  assert.strictEqual(isTransientError(minErr), true);

  const dayErr = new Error('Rate limit exceeded: free-models-per-day.');
  dayErr.status = 429;
  assert.strictEqual(isTransientError(dayErr), false);
});

test('errorHint: подсказки для 429 по free-models-per-day, free-models-per-min и другим 429', async () => {
  const { errorHint } = await import('../src/llm/errors.js');

  const dayErr = new Error('Rate limit exceeded: free-models-per-day.');
  dayErr.status = 429;
  assert.ok(errorHint(dayErr).includes('Дневной лимит бесплатных моделей OpenRouter исчерпан'));

  const minErr = new Error('Rate limit exceeded: free-models-per-min.');
  minErr.status = 429;
  assert.ok(errorHint(minErr).includes('Минутный лимит OpenRouter (20 запросов в минуту)'));

  const otherErr = new Error('Rate limit exceeded: other-metric.');
  otherErr.status = 429;
  assert.strictEqual(
    errorHint(otherErr),
    'Превышен лимит запросов для этой модели — подождите или выберите другую через /model'
  );
});
