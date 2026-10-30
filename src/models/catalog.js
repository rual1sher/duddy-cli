/**
 * @fileoverview Каталог моделей, кэширование и предоставление отсортированных списков
 */

import { getProviderKey } from '../providers.js';
import {
  readStatus,
  checkModelBusy,
  getUnavailableReason,
  UNAVAILABLE_REASONS,
  setOnModelUnavailable
} from './status.js';
import {
  needsProbe,
  probeProvider,
  isOpenRouterFreeOnly
} from './probe.js';
import { fetchGoogleModels } from './google.js';
import { fetchOpenRouterModels } from './openrouter.js';

/**
 * Кэш каталога моделей в памяти модуля
 * @type {{ google: Array<object>|null, openrouter: Array<object>|null }}
 */
export const catalogCache = {
  google: null,
  openrouter: null
};

setOnModelUnavailable((provider, id, reason) => {
  if (Array.isArray(catalogCache[provider])) {
    for (const m of catalogCache[provider]) {
      if (m.id === id) m.unavailable = reason;
    }
  }
});

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
 * Загрузить модели одного провайдера: кэш, API-запрос, пробинг и разметка недоступности
 *
 * @param {string} provider - Идентификатор провайдера ('google'|'openrouter')
 * @param {Record<string, string>} keys - Ключи провайдеров
 * @returns {Promise<{ provider: string, models: Array<object> }>}
 */
async function loadProviderModels(provider, keys) {
  if (catalogCache[provider]) {
    return { provider, models: catalogCache[provider] };
  }

  const key = keys[provider];
  let models = [];
  let probe = false;
  let freeOnlyKey = false;
  if (provider === 'google') {
    models = await fetchGoogleModels(key);
    probe = true;
  } else if (provider === 'openrouter') {
    const [all, freeOnly] = await Promise.all([fetchOpenRouterModels(), isOpenRouterFreeOnly(key)]);
    freeOnlyKey = freeOnly;
    models = all;
    // Probing hundreds of paid models is too costly; they are marked on the first real error instead
    probe = freeOnly;

    if (freeOnlyKey) {
      const freeTwinIds = new Set(
        models.filter(m => m.id.endsWith(':free')).map(m => m.id)
      );
      models = models.filter(m => !freeTwinIds.has(`${m.id}:free`));
    }
  }

  if (probe && needsProbe(provider)) {
    const candidates = freeOnlyKey ? models.filter(m => m.free) : models;
    await probeProvider(provider, candidates, key);
  }

  models = models
    .map(m => {
      const storedReason = getUnavailableReason(provider, m.id);
      const unavailable = storedReason === 'retired'
        ? 'retired'
        : (provider === 'openrouter' && freeOnlyKey && !m.free ? 'plan' : storedReason);
      return {
        ...m,
        unavailable
      };
    })
    .filter(m => m.unavailable !== 'retired');

  catalogCache[provider] = models;
  return { provider, models };
}

/**
 * Обогатить модели статусом busy и отсортировать по доступности и активности провайдера
 *
 * @param {Array<object>} models - Список моделей
 * @param {string} activeProvider - Текущий активный провайдер
 * @returns {Array<object>}
 */
function sortByAvailability(models, activeProvider) {
  const status = readStatus();
  const now = Date.now();
  const reasonKeys = Object.keys(UNAVAILABLE_REASONS);
  const reasonOrderMap = new Map(reasonKeys.map((k, i) => [k, i]));

  const getAvailabilityTier = (m) => {
    if (!m.unavailable && !m.busy) return 0;
    if (m.busy) return 1;
    return 2;
  };

  const enriched = models
    .filter(m => m.unavailable !== 'retired')
    .map((m, index) => ({
      ...m,
      busy: m.unavailable ? false : checkModelBusy(status.busy, m.provider, m.id, now),
      _index: index
    }));

  enriched.sort((a, b) => {
    // 1. Уровень: рабочие (0) → перегруженные (1) → недоступные (2)
    const tierA = getAvailabilityTier(a);
    const tierB = getAvailabilityTier(b);
    if (tierA !== tierB) {
      return tierA - tierB;
    }

    // 2. Внутри недоступных — по причине в порядке UNAVAILABLE_REASONS
    if (tierA === 2 && tierB === 2) {
      const rankA = reasonOrderMap.has(a.unavailable) ? reasonOrderMap.get(a.unavailable) : 999;
      const rankB = reasonOrderMap.has(b.unavailable) ? reasonOrderMap.get(b.unavailable) : 999;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
    }

    // 3. Затем провайдер: активный первым
    const pRankA = a.provider === activeProvider ? 0 : 1;
    const pRankB = b.provider === activeProvider ? 0 : 1;
    if (pRankA !== pRankB) {
      return pRankA - pRankB;
    }

    // 4. Иначе — исходный порядок
    return a._index - b._index;
  });

  return enriched.map(({ _index, ...m }) => m);
}

/**
 * Получить общий отсортированный список доступных моделей с кэшированием по провайдеру.
 *
 * Исключает навсегда отключённые модели (retired) и платные дубликаты
 * при бесплатном ключе OpenRouter. Сортирует модели в едином порядке:
 * рабочие → перегруженные → недоступные (по причинам UNAVAILABLE_REASONS);
 * внутри каждой группы активный провайдер идёт первым, сохраняя исходный порядок моделей.
 *
 * @param {object} [config={}] - Объект конфигурации пользователя
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number, free?: boolean, unavailable?: string|null, busy?: boolean }>>}
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

  const keys = { google: googleKey, openrouter: openrouterKey };
  const results = await Promise.allSettled(
    providersToFetch.map(provider => loadProviderModels(provider, keys))
  );

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

  return sortByAvailability(combined, activeProvider);
}
