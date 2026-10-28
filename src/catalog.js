/**
 * @fileoverview Каталог моделей из API OpenRouter и Google AI Studio
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProvider, getProviderKey } from './providers.js';

const STATUS_FILE = path.join(os.homedir(), '.config', 'duddy', 'models-status.json');
// Plan, region and retirement rarely change, so a weekly re-check is enough
const STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Fast refusals (no quota, retired, region) come back in under a second;
// anything slower is load, which is temporary and must not hide a model
const PROBE_TIMEOUT_MS = 8000;

/**
 * Причины, по которым модель скрыта из списка: она не заработает с этим ключом,
 * пока не изменится тариф, регион или сама модель
 */
export const UNAVAILABLE_REASONS = {
  plan: 'недоступна на вашем тарифе',
  region: 'недоступна в вашем регионе',
  retired: 'отключена провайдером',
  policy: 'запрещена настройками приватности OpenRouter',
  restricted: 'доступ ограничен провайдером'
};

const GOOGLE_EXCLUDED_SUBSTRINGS = [
  'tts',
  'image',
  'banana',
  'lyria',
  'robotics',
  'deep-research',
  'antigravity',
  'computer-use',
  'transcribe',
  'customtools',
  'embedding',
  'aqa'
];

/**
 * Кэш каталога моделей в памяти модуля
 * @type {{ google: Array<object>|null, openrouter: Array<object>|null }}
 */
const catalogCache = {
  google: null,
  openrouter: null
};

function readStatus() {
  try {
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    return { models: data.models || {}, probedAt: data.probedAt || {} };
  } catch {
    return { models: {}, probedAt: {} };
  }
}

function writeStatus(status) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // The list still works without the cache, it is just re-checked next time
  }
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
  writeStatus(status);
  if (Array.isArray(catalogCache[provider])) {
    catalogCache[provider] = catalogCache[provider].filter(m => m.id !== id);
  }
}

/**
 * Разобрать ошибку запроса к модели; если она означает постоянную недоступность —
 * скрыть модель из списка
 *
 * @param {string} provider - Идентификатор провайдера
 * @param {string} id - Идентификатор модели
 * @param {Error & { status?: number }} err - Ошибка запроса
 * @returns {string|null} Ключ причины или null для временных ошибок
 */
export function noteModelError(provider, id, err) {
  const reason = classifyModelError(err?.status, err?.message);
  if (reason) {
    markModelUnavailable(provider, id, reason);
  }
  return reason;
}

/**
 * Проверить модель минимальным запросом
 *
 * @returns {Promise<string|null>} Причина недоступности или null
 */
async function probeModel(provider, id, key) {
  const { baseURL, headers } = getProvider(provider);
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (res.ok) return null;
    return classifyModelError(res.status, await res.text());
  } catch {
    return null;
  }
}

/**
 * Проверить все модели провайдера параллельно и сохранить результат
 */
async function probeProvider(provider, models, key) {
  const reasons = await Promise.all(models.map(m => probeModel(provider, m.id, key)));
  const status = readStatus();
  models.forEach((m, i) => {
    const k = `${provider}:${m.id}`;
    if (reasons[i]) {
      status.models[k] = { reason: reasons[i], at: Date.now() };
    } else {
      delete status.models[k];
    }
  });
  status.probedAt[provider] = Date.now();
  writeStatus(status);
}

function needsProbe(provider) {
  const at = readStatus().probedAt[provider];
  return !at || Date.now() - at > STATUS_TTL_MS;
}

/**
 * Ключ OpenRouter без средств может вызывать только бесплатные модели
 *
 * @param {string} key - API-ключ OpenRouter
 * @returns {Promise<boolean>}
 */
async function isOpenRouterFreeOnly(key) {
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

/**
 * Очистить кэш каталога моделей
 *
 * @param {string} [provider] - Идентификатор провайдера (если не указан, очищаются все)
 */
export function clearCatalogCache(provider) {
  if (provider) {
    catalogCache[provider] = null;
  } else {
    catalogCache.google = null;
    catalogCache.openrouter = null;
  }
}

/**
 * Найти модель в кэше каталога по её ID
 *
 * @param {string} id - Идентификатор модели
 * @returns {{ id: string, name: string, provider: string, contextLength?: number }|null}
 */
export function findModel(id) {
  if (!id) return null;
  const cleanId = String(id).replace(/^models\//, '');
  for (const provider of ['google', 'openrouter']) {
    const list = catalogCache[provider];
    if (Array.isArray(list)) {
      const found = list.find(m => m.id === cleanId || m.id === id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Проверить валидность API-ключа Google AI Studio
 *
 * @param {string} key - API-ключ Google AI Studio
 * @returns {Promise<boolean>}
 */
export async function validateGoogleKey(key) {
  if (!key) {
    throw new Error('Ключ Google AI Studio не указан');
  }

  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: {
        'x-goog-api-key': key
      },
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Таймаут подключения к Google AI Studio (8с)');
    }
    throw new Error(`Ошибка сети Google AI Studio: ${err.message}`);
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error('Ключ Google AI Studio не подошёл');
    }
    throw new Error(`Google AI Studio вернул ошибку HTTP ${res.status}`);
  }

  return true;
}

/**
 * Сортировка моделей Google Gemini согласно правилам
 *
 * @param {Array<object>} models - Массив отфильтрованных моделей Google
 * @returns {Array<object>}
 */
function sortGoogleModels(models) {
  const isGemma = (id) => id.toLowerCase().startsWith('gemma');
  const isLatest = (id) => id.toLowerCase().includes('-latest');

  const getTier = (id) => {
    const lower = id.toLowerCase();
    if (lower.includes('pro')) return 1;
    if (lower.includes('flash-lite') || lower.includes('flash_lite') || lower.includes('lite')) return 3;
    if (lower.includes('flash')) return 2;
    return 4;
  };

  const getVersion = (id) => {
    const match = id.match(/\d+(?:\.\d+)*/);
    return match ? match[0] : '';
  };

  return [...models].sort((a, b) => {
    const aId = a.id;
    const bId = b.id;

    // gemma-* в конце
    const aGemma = isGemma(aId);
    const bGemma = isGemma(bId);
    if (aGemma !== bGemma) {
      return aGemma ? 1 : -1;
    }
    if (aGemma && bGemma) {
      return bId.localeCompare(aId, undefined, { numeric: true });
    }

    // Сначала алиасы с '-latest' (Pro → Flash → Flash-Lite)
    const aLatest = isLatest(aId);
    const bLatest = isLatest(bId);
    if (aLatest !== bLatest) {
      return aLatest ? -1 : 1;
    }
    if (aLatest && bLatest) {
      const tierDiff = getTier(aId) - getTier(bId);
      if (tierDiff !== 0) return tierDiff;
      return bId.localeCompare(aId, undefined, { numeric: true });
    }

    // Затем остальные по убыванию версии
    const aVer = getVersion(aId);
    const bVer = getVersion(bId);
    if (aVer && bVer && aVer !== bVer) {
      const verDiff = bVer.localeCompare(aVer, undefined, { numeric: true });
      if (verDiff !== 0) return verDiff;
    } else if (aVer && !bVer) {
      return -1;
    } else if (!aVer && bVer) {
      return 1;
    }

    // Внутри одной версии Pro раньше Flash раньше Lite
    const tierDiff = getTier(aId) - getTier(bId);
    if (tierDiff !== 0) return tierDiff;

    return bId.localeCompare(aId, undefined, { numeric: true });
  });
}

/**
 * Загрузить и отфильтровать список моделей Google AI Studio
 *
 * @param {string} key - API-ключ Google AI Studio
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number }>>}
 */
async function fetchGoogleModels(key) {
  let pageToken = '';
  let pages = 0;
  const rawModels = [];

  while (pages < 5) {
    pages++;
    let url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const res = await fetch(url, {
      headers: {
        'x-goog-api-key': key
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new Error('Ключ Google AI Studio не подошёл');
      }
      throw new Error(`Google AI Studio HTTP ${res.status}`);
    }

    const json = await res.json();
    if (Array.isArray(json.models)) {
      rawModels.push(...json.models);
    }

    pageToken = json.nextPageToken;
    if (!pageToken) {
      break;
    }
  }

  const filtered = [];
  for (const m of rawModels) {
    if (!m || !m.name) continue;
    const cleanId = m.name.replace(/^models\//, '');
    const lowerId = cleanId.toLowerCase();

    // Оставить модели с 'generateContent' в supportedGenerationMethods
    if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes('generateContent')) {
      continue;
    }

    // Исключить, если id содержит нечатовые подстроки
    if (GOOGLE_EXCLUDED_SUBSTRINGS.some(sub => lowerId.includes(sub))) {
      continue;
    }

    filtered.push({
      id: cleanId,
      name: m.displayName || cleanId,
      provider: 'google',
      contextLength: m.inputTokenLimit
    });
  }

  return sortGoogleModels(filtered);
}

/**
 * Загрузить и отфильтровать список моделей OpenRouter
 *
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number }>>}
 */
async function fetchOpenRouterModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];

  const filtered = [];
  for (const m of rawList) {
    // Batch endpoints are asynchronous and useless for chat
    if (!m || !m.id || m.id.endsWith(':batch')) continue;
    const hasTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools');
    if (!hasTools && m.id !== 'openrouter/free') {
      continue;
    }

    filtered.push({
      id: m.id,
      name: m.name || m.id,
      provider: 'openrouter',
      contextLength: m.context_length,
      free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0
    });
  }

  // 'openrouter/free' — первой
  const freeIndex = filtered.findIndex(m => m.id === 'openrouter/free');
  if (freeIndex > 0) {
    const [freeItem] = filtered.splice(freeIndex, 1);
    filtered.unshift(freeItem);
  } else if (freeIndex === -1) {
    filtered.unshift({
      id: 'openrouter/free',
      name: 'OpenRouter Free',
      provider: 'openrouter',
      contextLength: 200000,
      free: true
    });
  }

  return filtered;
}

/**
 * Получить общий список доступных моделей с кэшированием по провайдеру
 *
 * @param {object} [config={}] - Объект конфигурации пользователя
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number }>>}
 */
export async function listModels(config = {}) {
  const providersToFetch = [];
  const googleKey = getProviderKey('google', config);
  const openrouterKey = getProviderKey('openrouter', config);

  if (googleKey) providersToFetch.push('google');
  if (openrouterKey) providersToFetch.push('openrouter');

  if (providersToFetch.length === 0) {
    return [];
  }

  const tasks = providersToFetch.map(async (provider) => {
    if (catalogCache[provider]) {
      return { provider, models: catalogCache[provider] };
    }

    let models = [];
    let probe = false;
    if (provider === 'google') {
      models = await fetchGoogleModels(googleKey);
      probe = true;
    } else if (provider === 'openrouter') {
      const [all, freeOnly] = await Promise.all([fetchOpenRouterModels(), isOpenRouterFreeOnly(openrouterKey)]);
      models = freeOnly ? all.filter(m => m.free) : all;
      // Probing hundreds of paid models is too costly; they are hidden on the first real error instead
      probe = freeOnly;
    }

    if (probe && needsProbe(provider)) {
      await probeProvider(provider, models, provider === 'google' ? googleKey : openrouterKey);
    }
    models = models.filter(m => !getUnavailableReason(provider, m.id));

    catalogCache[provider] = models;
    return { provider, models };
  });

  const results = await Promise.allSettled(tasks);

  const providerMap = {};
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value) {
      providerMap[res.value.provider] = res.value.models;
    }
  }

  const activeProvider = config.provider || 'openrouter';
  const order = activeProvider === 'google'
    ? ['google', 'openrouter']
    : ['openrouter', 'google'];

  const combined = [];
  for (const p of order) {
    if (providerMap[p]) {
      combined.push(...providerMap[p]);
    }
  }

  return combined;
}
