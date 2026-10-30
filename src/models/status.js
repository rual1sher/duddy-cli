/**
 * @fileoverview Хранение статусов моделей, проверка временных перегрузок и классификация ошибок
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATUS_FILE = path.join(os.homedir(), '.config', 'duddy', 'models-status.json');
// Plan, region and retirement rarely change, so a weekly re-check is enough
export const STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Временная перегрузка считается активной 15 минут
export const BUSY_TTL_MS = 15 * 60 * 1000;

/**
 * Причины, по которым модель скрыта из списка: она не заработает с этим ключом,
 * пока не изменится тариф, регион или сама модель
 */
export const UNAVAILABLE_REASONS = {
  plan: 'платная — нет доступа с вашим ключом',
  region: 'недоступна в вашем регионе',
  retired: 'отключена провайдером',
  policy: 'запрещена настройками приватности OpenRouter',
  restricted: 'доступ ограничен провайдером'
};

let onModelUnavailable = null;

/**
 * Зарегистрировать слушатель для инвалидации/обновления кэша моделей
 *
 * @param {(provider: string, id: string, reason: string) => void} fn
 */
export function setOnModelUnavailable(fn) {
  onModelUnavailable = fn;
}

export function readStatus() {
  try {
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    return {
      models: data.models || {},
      probedAt: data.probedAt || {},
      busy: data.busy || {}
    };
  } catch {
    return { models: {}, probedAt: {}, busy: {} };
  }
}

export function writeStatus(status) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true, mode: 0o700 });
    const payload = {
      models: status.models || {},
      probedAt: status.probedAt || {},
      busy: status.busy || {}
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // The list still works without the cache, it is just re-checked next time
  }
}

/**
 * Проверить, является ли ошибка временной перегрузкой модели
 *
 * @param {number|string} [status] - HTTP-статус
 * @param {string} [message=''] - Текст ошибки
 * @returns {boolean}
 */
export function isTemporaryOverload(status, message = '') {
  const s = Number(status);
  if (s === 500 || s === 502 || s === 503 || s === 504) {
    return true;
  }
  const msg = String(message || '').toLowerCase();
  if (msg.includes('no longer available')) {
    return false;
  }
  if (
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('internal error') ||
    msg.includes('unavailable')
  ) {
    return true;
  }
  return false;
}

/**
 * Внутренняя проверка флага busy по переданной карте busy
 *
 * @param {Record<string, number>} busyMap - Словарь времени пометок
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {number} [now=Date.now()] - Текущее время в ms
 * @returns {boolean}
 */
export function checkModelBusy(busyMap, provider, id, now = Date.now()) {
  const at = busyMap?.[`${provider}:${id}`];
  if (!at) return false;
  return now - at <= BUSY_TTL_MS;
}

/**
 * Запомнить, что модель временно перегружена
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 */
export function markModelBusy(provider, id) {
  if (!provider || !id) return;
  const status = readStatus();
  status.busy[`${provider}:${id}`] = Date.now();
  writeStatus(status);
}

/**
 * Снять пометку временной перегрузки модели
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 */
export function clearModelBusy(provider, id) {
  if (!provider || !id) return;
  const status = readStatus();
  const key = `${provider}:${id}`;
  if (status.busy[key]) {
    delete status.busy[key];
    writeStatus(status);
  }
}

/**
 * Проверить, помечена ли модель как временно перегруженная
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @returns {boolean}
 */
export function isModelBusy(provider, id) {
  const status = readStatus();
  return checkModelBusy(status.busy, provider, id);
}

/**
 * Определить по ответу провайдера, что модель недоступна для этого ключа надолго.
 * Временные ошибки (перегрузка, лимит в минуту, 5xx, таймаут) возвращают null.
 *
 * @param {number} status - HTTP-статус
 * @param {string} message - Текст ошибки
 * @returns {keyof UNAVAILABLE_REASONS | null}
 */
export function classifyModelError(status, message = '') {
  const msg = String(message).toLowerCase();

  // Errors about the key or the request itself say nothing about the model
  if (msg.includes('api key') || msg.includes('api_key') || msg.includes('flagged') || msg.includes('moderation')) {
    return null;
  }
  if (status === 402 || msg.includes('insufficient credits') || msg.includes('requires more credits')) {
    return 'plan';
  }
  // Google: "...free_tier_requests, limit: 0..." means the model is not on the free tier at all
  if (msg.includes('free_tier') && msg.includes('limit: 0')) {
    return 'plan';
  }
  if (msg.includes('location is not supported') || msg.includes('not available in your region') ||
      msg.includes('not available in your country') || msg.includes('unsupported_country')) {
    return 'region';
  }
  if (msg.includes('data policy')) {
    return 'policy';
  }
  if (status === 404 && (msg.includes('no longer available') || msg.includes('not found') || msg.includes('does not exist'))) {
    return 'retired';
  }
  if (status === 403) {
    return 'restricted';
  }
  return null;
}

/**
 * Причина, по которой модель скрыта, или null
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @returns {string|null}
 */
export function getUnavailableReason(provider, id) {
  const entry = readStatus().models[`${provider}:${id}`];
  if (!entry || Date.now() - entry.at > STATUS_TTL_MS) return null;
  return entry.reason;
}

/**
 * Запомнить, что модель недоступна, и убрать её из текущего списка
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {string} reason - Ключ из UNAVAILABLE_REASONS
 */
export function markModelUnavailable(provider, id, reason) {
  const status = readStatus();
  status.models[`${provider}:${id}`] = { reason, at: Date.now() };
  if (status.busy[`${provider}:${id}`]) {
    delete status.busy[`${provider}:${id}`];
  }
  writeStatus(status);
  if (onModelUnavailable) {
    onModelUnavailable(provider, id, reason);
  }
}

/**
 * Разобрать ошибку запроса к модели; если она означает постоянную недоступность —
 * скрыть модель из списка, если временную перегрузку — пометить как занятую
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {Error & { status?: number, code?: string }} err - Ошибка запроса
 * @returns {string|null} Ключ причины или null для временных ошибок
 */
export function noteModelError(provider, id, err) {
  const reason = classifyModelError(err?.status, err?.message);
  if (reason) {
    markModelUnavailable(provider, id, reason);
    return reason;
  }
  if (isTemporaryOverload(err?.status, err?.message)) {
    markModelBusy(provider, id);
  }
  return null;
}
