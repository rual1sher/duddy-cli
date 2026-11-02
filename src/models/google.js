/**
 * @fileoverview Загрузка и валидация моделей из Google AI Studio
 */

import {
  GOOGLE_EXCLUDED_SUBSTRINGS,
  isCodeUnfit,
  sortGoogleModels
} from './filters.js';

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
 * Преобразовать сырую модель Google в запись каталога или отфильтровать
 *
 * @param {object} m - Сырой объект модели из API
 * @returns {{ id: string, name: string, provider: string, contextLength?: number, vision: boolean }|null}
 */
function toModelEntry(m) {
  if (!m || !m.name) return null;
  const cleanId = m.name.replace(/^models\//, '');
  const lowerId = cleanId.toLowerCase();

  // Оставить модели с 'generateContent' в supportedGenerationMethods
  if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes('generateContent')) {
    return null;
  }

  // Исключить, если id содержит нечатовые подстроки
  if (GOOGLE_EXCLUDED_SUBSTRINGS.some(sub => lowerId.includes(sub))) {
    return null;
  }

  if (isCodeUnfit(cleanId)) {
    return null;
  }

  return {
    id: cleanId,
    name: m.displayName || cleanId,
    provider: 'google',
    contextLength: m.inputTokenLimit,
    vision: true
  };
}

/**
 * Загрузить и отфильтровать список моделей Google AI Studio
 *
 * @param {string} key - API-ключ Google AI Studio
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number }>>}
 */
export async function fetchGoogleModels(key) {
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
    const entry = toModelEntry(m);
    if (entry) {
      filtered.push(entry);
    }
  }

  return sortGoogleModels(filtered);
}
