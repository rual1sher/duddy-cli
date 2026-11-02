/**
 * @fileoverview Учёт лимитов запросов, заголовков RateLimit и отказов 429 по моделям
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Возвращает путь к файлу с лимитами моделей.
 * Путь вычисляется при каждом вызове, так как тесты могут менять process.env.HOME.
 *
 * @returns {string}
 */
export function limitsFile() {
  return path.join(os.homedir(), '.config', 'duddy', 'model-limits.json');
}

/**
 * Читает сохранённые лимиты моделей из конфигурационного файла.
 * При любой ошибке возвращает объект с пустым словарем models.
 *
 * @returns {{ models: Record<string, object> }}
 */
export function readLimits() {
  try {
    const data = JSON.parse(fs.readFileSync(limitsFile(), 'utf8'));
    return {
      models: data && typeof data.models === 'object' && data.models !== null ? data.models : {}
    };
  } catch {
    return { models: {} };
  }
}

/**
 * Записывает лимиты моделей в файл с безопасными правами доступа (0o600).
 *
 * @param {{ models: Record<string, object> }} limits
 */
export function writeLimits(limits) {
  try {
    const file = limitsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const payload = {
      models: limits.models || {}
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ошибки записи молча игнорируются
  }
}

/**
 * Преобразует значение заголовка в конечное число или null
 *
 * @param {*} val
 * @returns {number|null}
 */
function parseHeaderNumber(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '') return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

/**
 * Разбирает заголовки лимитов (RateLimit) из ответа модели
 *
 * @param {Headers|{ get: (name: string) => string|null }} headers - Объект заголовков с методом get
 * @returns {{ limitRequests: number|null, remainingRequests: number|null, limitTokens: number|null, remainingTokens: number|null }|null}
 */
export function parseRateHeaders(headers) {
  if (!headers || typeof headers.get !== 'function') return null;

  const limitRequests = parseHeaderNumber(headers.get('x-ratelimit-limit-requests')) ??
    parseHeaderNumber(headers.get('x-ratelimit-limit'));
  const remainingRequests = parseHeaderNumber(headers.get('x-ratelimit-remaining-requests')) ??
    parseHeaderNumber(headers.get('x-ratelimit-remaining'));
  const limitTokens = parseHeaderNumber(headers.get('x-ratelimit-limit-tokens'));
  const remainingTokens = parseHeaderNumber(headers.get('x-ratelimit-remaining-tokens'));

  if (limitRequests === null && remainingRequests === null && limitTokens === null && remainingTokens === null) {
    return null;
  }

  return {
    limitRequests,
    remainingRequests,
    limitTokens,
    remainingTokens
  };
}

/**
 * Извлекает данные о квоте и повторе из ошибки 429
 *
 * @param {Error & { error?: { metadata?: { headers?: Record<string, string> } }, headers?: Headers }} err
 * @returns {{ limit: number|null, metric: string|null, retryAfterSec: number|null }}
 */
export function parseQuotaError(err) {
  const msg = String(err?.message || '');

  let metaLimit = null;
  const metaHeaders = err?.error?.metadata?.headers;
  if (metaHeaders && typeof metaHeaders === 'object') {
    for (const [k, v] of Object.entries(metaHeaders)) {
      if (k.toLowerCase() === 'x-ratelimit-limit') {
        const n = parseHeaderNumber(v);
        if (n !== null) {
          metaLimit = n;
          break;
        }
      }
    }
  }

  const limitMatch = msg.match(/limit:\s*(\d+)/i);
  const limit = limitMatch ? Number(limitMatch[1]) : metaLimit;

  const metricMatch = msg.match(/metric:\s*([\w./-]+)/i) || msg.match(/rate limit exceeded:\s*([\w-]+)/i);
  let metric = null;
  if (metricMatch) {
    const raw = metricMatch[1];
    const slashIdx = raw.lastIndexOf('/');
    metric = slashIdx !== -1 ? raw.slice(slashIdx + 1) : raw;
  }

  const retryMatch = msg.match(/retry in ([\d.]+)\s*s/i);
  let retryAfterSec = null;
  if (retryMatch) {
    retryAfterSec = Number(retryMatch[1]);
  } else if (typeof err?.headers?.get === 'function') {
    retryAfterSec = parseHeaderNumber(err.headers.get('retry-after'));
  }

  return {
    limit,
    metric,
    retryAfterSec
  };
}

/**
 * Записывает факт успешного запроса к модели и обновляет счётчики за день
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {object} [usage] - Статистика токенов запроса
 * @param {object|null} [rateLimits] - Распарсенные заголовки лимитов
 */
export function recordRequest(provider, id, usage, rateLimits) {
  if (!provider || !id) return;
  const key = `${provider}:${id}`;
  const limits = readLimits();
  const existing = limits.models[key] || {};
  const today = new Date().toISOString().slice(0, 10);

  let requests = existing.requests || 0;
  let tokens = existing.tokens || 0;
  if (existing.day !== today) {
    requests = 0;
    tokens = 0;
  }
  requests += 1;
  tokens += usage?.total_tokens || 0;

  const updated = {
    ...existing,
    day: today,
    requests,
    tokens
  };

  if (rateLimits) {
    updated.rate = {
      ...rateLimits,
      at: Date.now()
    };
  }

  limits.models[key] = updated;
  writeLimits(limits);
}

/**
 * Записывает информацию об отказе по квоте 429
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {Error|object} err - Объект ошибки
 */
export function recordQuotaHit(provider, id, err) {
  if (!provider || !id) return;
  const key = `${provider}:${id}`;
  const limits = readLimits();
  const existing = limits.models[key] || {};
  const parsed = parseQuotaError(err);
  const hit = {
    ...parsed,
    at: Date.now()
  };

  limits.models[key] = {
    ...existing,
    hit
  };
  writeLimits(limits);
}
