/**
 * @fileoverview Повторные попытки при временных сетевых ошибках стрима
 */

import { parseQuotaError } from '../models/limits.js';

/** Паузы между попытками по умолчанию (мс): 1, 2, 4, 8, 15 секунд */
const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 15000];

/** Регулярное выражение для выявления временных сетевых сбоев */
const TRANSIENT_RE =
  /timed? ?out|timeout|terminated|ECONNRESET|socket hang up|other side closed|fetch failed|connection error/i;

/**
 * Вычисляет время ожидания в миллисекундах при превышении минутного лимита запросов.
 * Возвращает null, если ошибка не относится к минутному лимиту (например, дневной лимит или другой статус).
 *
 * @param {Error|object} err - Объект ошибки
 * @param {object} [options={}]
 * @param {number} [options.minMs=1000] - Минимальное время ожидания в мс
 * @param {number} [options.maxMs=65000] - Максимальное время ожидания в мс
 * @returns {number|null} Время ожидания в мс или null
 */
export function rateLimitWaitMs(err, { minMs = 1000, maxMs = 65000 } = {}) {
  if (!err) return null;
  const status = err.status || err.statusCode || 0;
  if (status !== 429) return null;

  const quota = parseQuotaError(err);
  const metric = quota?.metric || '';
  const msg = String(err.message || '');
  const isMinuteLimit = (typeof metric === 'string' && metric.includes('per-min')) || /per-min/i.test(msg);
  if (!isMinuteLimit) return null;

  let resetVal = null;
  const metaHeaders = err.error?.metadata?.headers;
  if (metaHeaders && typeof metaHeaders === 'object') {
    for (const [k, v] of Object.entries(metaHeaders)) {
      if (k.toLowerCase() === 'x-ratelimit-reset') {
        resetVal = v;
        break;
      }
    }
  }
  if (resetVal == null && typeof err.headers?.get === 'function') {
    resetVal = err.headers.get('x-ratelimit-reset');
  }

  let waitMs = null;
  if (resetVal !== null && resetVal !== undefined) {
    const num = Number(resetVal);
    if (Number.isFinite(num) && num > 0) {
      if (num > 1e12) {
        waitMs = num - Date.now() + 500;
      } else if (num > 1e9) {
        waitMs = (num * 1000) - Date.now() + 500;
      } else {
        waitMs = num * 1000;
      }
    }
  }

  if (waitMs === null) {
    if (typeof quota?.retryAfterSec === 'number' && quota.retryAfterSec > 0) {
      waitMs = quota.retryAfterSec * 1000;
    } else {
      waitMs = 30000;
    }
  }

  return Math.max(minMs, Math.min(maxMs, waitMs));
}

/**
 * Проверяет, является ли ошибка временной (сетевой/серверной), при которой
 * имеет смысл повторить запрос.
 *
 * Временная, если:
 * — name равен 'APIConnectionTimeoutError' или 'APIConnectionError';
 * — status равен 408, 500, 502, 503, 504 или 520–529;
 * — status равен 429 при минутном лимите (rateLimitWaitMs(err) !== null);
 * — нет status, но текст сообщения или err.cause совпадает с паттерном
 *   тайм-аутов, разрывов соединения и сетевых сбоев.
 *
 * AbortError, ошибки 4xx (кроме 408 и минутного 429) и 501 не считаются временными.
 *
 * @param {Error|object} err - Объект ошибки
 * @returns {boolean}
 */
export function isTransientError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;

  const name = err.name || '';
  if (name === 'APIConnectionTimeoutError' || name === 'APIConnectionError') return true;

  const status = err.status || err.statusCode || 0;
  if (status) {
    if (status === 408) return true;
    if (status === 429) return rateLimitWaitMs(err) !== null;
    if (status === 500 || (status >= 502 && status <= 504)) return true;
    if (status >= 520 && status <= 529) return true;
    // 4xx (кроме 408 и минутного 429) и 501 не повторяем
    if ((status >= 400 && status < 500) || status === 501) return false;
  }

  const msgText = err.message || '';
  const causeText = typeof err.cause === 'string'
    ? err.cause
    : (err.cause?.message || '');
  return TRANSIENT_RE.test(msgText) || TRANSIENT_RE.test(causeText);
}

/**
 * Пауза в мс, прерывается по signal.
 *
 * @param {number} ms - Время ожидания в мс
 * @param {AbortSignal} [signal] - Сигнал отмены
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Request was aborted.');
      e.name = 'AbortError';
      return reject(e);
    }
    let timer = null;
    let onAbort = null;
    const cleanup = () => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    onAbort = () => {
      clearTimeout(timer);
      cleanup();
      const e = new Error('Request was aborted.');
      e.name = 'AbortError';
      reject(e);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Выполняет run() с повторными попытками при временных ошибках.
 * Повтор происходит не более delays.length раз с паузами из delays (или паузой лимита для 429).
 * Повтор разрешён только если canRetry() возвращает true и signal не отменён.
 * Пауза прерывается по signal — тогда бросается AbortError.
 * Повторы молчаливые, ничего не печатают.
 *
 * @param {Function} run - Функция, возвращающая Promise запроса
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Сигнал отмены
 * @param {Function} [options.canRetry] - Возвращает true, если повтор разрешён
 * @param {number[]} [options.delays] - Паузы в мс (по умолчанию DEFAULT_DELAYS)
 * @param {(info: { ms: number, rateLimited: boolean }) => void} [options.onWait] - Колбэк перед паузой
 * @param {number} [options.rateLimitMinMs] - Минимальное время ожидания минутного лимита в мс
 * @returns {Promise<*>} Результат run()
 */
export async function streamWithRetry(
  run,
  { signal, canRetry, delays = DEFAULT_DELAYS, onWait, rateLimitMinMs } = {}
) {
  let attempt = 0;
  while (true) {
    try {
      return await run();
    } catch (err) {
      const shouldRetry =
        isTransientError(err) &&
        !signal?.aborted &&
        (typeof canRetry !== 'function' || canRetry()) &&
        attempt < delays.length;

      if (!shouldRetry) throw err;

      const rlMs = rateLimitWaitMs(err, { minMs: rateLimitMinMs ?? 1000 });
      const rateLimited = rlMs !== null;
      const ms = rateLimited ? rlMs : delays[attempt];

      if (typeof onWait === 'function') {
        onWait({ ms, rateLimited });
      }

      await delay(ms, signal);
      attempt++;
    }
  }
}
