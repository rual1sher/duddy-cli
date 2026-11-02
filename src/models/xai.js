/**
 * @fileoverview Загрузка и валидация моделей xAI (Grok)
 */

import { getProvider } from '../providers.js';
import { isCodeUnfit } from './filters.js';

/**
 * Сформировать понятное сообщение об ошибке xAI
 *
 * @param {number} status - HTTP-статус ответа
 * @param {string} body - Текст ответа сервера
 * @param {string} [key] - API-ключ для маскировки
 * @returns {string} Текст ошибки для пользователя
 */
export function describeXaiError(status, body, key) {
  let reason = '';
  try {
    const data = JSON.parse(body);
    if (typeof data?.error === 'string') {
      reason = data.error;
    } else if (data?.error?.message != null) {
      reason = String(data.error.message);
    } else if (data?.message != null) {
      reason = String(data.message);
    } else if (data?.code != null) {
      reason = String(data.code);
    }
  } catch {
    reason = typeof body === 'string' ? body : (body != null ? String(body) : '');
  }

  // Сначала маскируем: обрезка могла бы разорвать ключ, и его начало осталось бы в тексте
  if (key && typeof key === 'string') {
    reason = reason.split(key).join('***');
  }

  reason = reason.replace(/\s+/g, ' ').trim();
  if (reason.length > 200) {
    reason = reason.slice(0, 200);
  }

  const lower = reason.toLowerCase();
  let text;

  if (status === 401 || (status === 400 && (lower.includes('api key') || lower.includes('api_key')))) {
    text = 'xAI не принял ключ: он неверный, отозван или скопирован не целиком. Создайте новый на console.x.ai';
  } else if (lower.includes('credit') || lower.includes('spending limit') || lower.includes('license')) {
    text = 'Ключ xAI настоящий, но на счёте нет средств. Пополните баланс на console.x.ai и вставьте ключ снова';
  } else if (status === 403) {
    text = 'xAI запретил доступ: у ключа нет нужных прав или доступ ограничен. Проверьте права ключа на console.x.ai';
  } else if (status === 429) {
    text = 'Слишком много запросов к xAI. Подождите минуту и попробуйте снова';
  } else if (status >= 500) {
    text = `xAI временно не работает (HTTP ${status}). Попробуйте позже`;
  } else {
    text = `xAI вернул ошибку HTTP ${status}`;
  }

  if (reason) {
    text += ` Ответ xAI: ${reason}`;
  }

  return text;
}

/**
 * Проверить валидность API-ключа xAI
 *
 * @param {string} key - API-ключ xAI
 * @returns {Promise<boolean>}
 */
export async function validateXaiKey(key) {
  if (!key) {
    throw new Error('Ключ xAI не указан');
  }

  let res;
  try {
    res = await fetch('https://api.x.ai/v1/models', {
      headers: {
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Таймаут подключения к xAI (8с)');
    }
    throw new Error(`Ошибка сети xAI: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(describeXaiError(res.status, await res.text().catch(() => ''), key));
  }

  return true;
}

/**
 * Преобразовать сырую модель xAI в запись каталога или отфильтровать
 *
 * @param {object} m - Сырой объект модели из API
 * @param {Map<string, number>} contextById - Словарь context_length по id
 * @returns {{ id: string, name: string, provider: string, contextLength?: number, vision: boolean }|null}
 */
function toModelEntry(m, contextById) {
  if (!m || !m.id) return null;
  if (!m.id.startsWith('grok-')) return null;
  if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) return null;
  if (m.id.includes('multi-agent')) return null;
  if (isCodeUnfit(m.id)) return null;

  return {
    id: m.id,
    name: m.id,
    provider: 'xai',
    contextLength: contextById.get(m.id),
    vision: Array.isArray(m.input_modalities) && m.input_modalities.includes('image')
  };
}

/**
 * Загрузить и отфильтровать список моделей xAI
 *
 * @param {string} key - API-ключ xAI
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number, vision: boolean }>>}
 */
export async function fetchXaiModels(key) {
  if (!key) {
    throw new Error('Ключ xAI не указан');
  }

  const modelsPromise = (async () => {
    try {
      const res = await fetch('https://api.x.ai/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return new Map();
      const json = await res.json();
      const list = Array.isArray(json.data) ? json.data : (Array.isArray(json.models) ? json.models : []);
      const map = new Map();
      for (const item of list) {
        if (item && item.id && typeof item.context_length === 'number') {
          map.set(item.id, item.context_length);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  })();

  let langRes;
  try {
    langRes = await fetch('https://api.x.ai/v1/language-models', {
      headers: {
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Таймаут подключения к xAI (8с)');
    }
    throw new Error(`Ошибка сети xAI: ${err.message}`);
  }

  if (!langRes.ok) {
    throw new Error(describeXaiError(langRes.status, await langRes.text().catch(() => ''), key));
  }

  const langJson = await langRes.json();
  const rawModels = Array.isArray(langJson.models) ? langJson.models : [];
  const contextById = await modelsPromise;

  const filtered = [];
  for (const m of rawModels) {
    const entry = toModelEntry(m, contextById);
    if (entry) {
      filtered.push(entry);
    }
  }

  const sorted = filtered.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  const defaultModel = getProvider('xai').defaultModel;
  const defIdx = sorted.findIndex(m => m.id === defaultModel);
  if (defIdx > 0) {
    const [def] = sorted.splice(defIdx, 1);
    sorted.unshift(def);
  }

  return sorted;
}
