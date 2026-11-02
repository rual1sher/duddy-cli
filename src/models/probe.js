/**
 * @fileoverview Проверка доступности моделей минимальными запросами (пробинг)
 */

import { getProvider } from '../providers.js';
import {
  STATUS_TTL_MS,
  classifyModelError,
  isTemporaryOverload,
  readStatus,
  writeStatus
} from './status.js';

// Fast refusals (no quota, retired, region) come back in under a second;
// anything slower is load, which is temporary and must not hide a model
export const PROBE_TIMEOUT_MS = 8000;

/**
 * Проверить модель минимальным запросом
 *
 * @returns {Promise<string|null>} Причина недоступности, 'busy' при временной перегрузке или null
 */
export async function probeModel(provider, id, key) {
  const { baseURL, headers } = getProvider(provider);
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (res.ok) return null;
    const body = await res.text();
    const reason = classifyModelError(res.status, body);
    if (reason) return reason;
    if (isTemporaryOverload(res.status, body)) return 'busy';
    return null;
  } catch {
    return 'busy';
  }
}

/**
 * Проверить все модели провайдера параллельно и сохранить результат
 */
export async function probeProvider(provider, models, key) {
  const reasons = await Promise.all(models.map(m => probeModel(provider, m.id, key)));
  const status = readStatus();
  models.forEach((m, i) => {
    const k = `${provider}:${m.id}`;
    const result = reasons[i];
    if (result === 'busy') {
      status.busy[k] = Date.now();
      delete status.models[k];
    } else if (result) {
      status.models[k] = { reason: result, at: Date.now() };
      delete status.busy[k];
    } else {
      delete status.models[k];
      delete status.busy[k];
    }
  });
  status.probedAt[provider] = Date.now();
  writeStatus(status);
}

export function needsProbe(provider) {
  const at = readStatus().probedAt[provider];
  return !at || Date.now() - at > STATUS_TTL_MS;
}

/**
 * Ключ OpenRouter без средств может вызывать только бесплатные модели
 *
 * @param {string} key - API-ключ OpenRouter
 * @returns {Promise<boolean>}
 */
export async function isOpenRouterFreeOnly(key) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return false;
    const { data } = await res.json();
    return (Number(data?.total_credits) || 0) - (Number(data?.total_usage) || 0) <= 0;
  } catch {
    return false;
  }
}
