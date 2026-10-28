/**
 * @fileoverview Каталог моделей из API OpenRouter и Google AI Studio
 */

import { getProviderKey } from './providers.js';

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
      contextLength: m.context_length
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
      contextLength: 200000
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
    if (provider === 'google') {
      models = await fetchGoogleModels(googleKey);
    } else if (provider === 'openrouter') {
      models = await fetchOpenRouterModels();
    }

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
