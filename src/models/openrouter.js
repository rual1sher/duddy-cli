/**
 * @fileoverview Загрузка и фильтрация моделей из API OpenRouter
 */

import {
  MAX_MODEL_AGE_MS,
  isCodeUnfit
} from './filters.js';

/**
 * Преобразовать сырую модель OpenRouter в запись каталога или отфильтровать
 *
 * @param {object} m - Сырой объект модели из API
 * @param {number} minCreatedSec - Минимальная дата создания модели в секундах
 * @returns {{ id: string, name: string, provider: string, contextLength?: number, free?: boolean, vision?: boolean }|null}
 */
function toModelEntry(m, minCreatedSec) {
  // Batch endpoints are asynchronous and useless for chat
  if (!m || !m.id || m.id.endsWith(':batch')) return null;

  if (m.id !== 'openrouter/free') {
    const hasTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools');
    if (!hasTools) {
      return null;
    }

    // Отбрасываем модели с output_modalities не ровно ["text"] (генераторы картинок/аудио)
    const outputModalities = m.architecture?.output_modalities;
    if (outputModalities != null) {
      const isOnlyText = Array.isArray(outputModalities) &&
        outputModalities.length === 1 &&
        outputModalities[0] === 'text';
      if (!isOnlyText) {
        return null;
      }
    }

    // Классификаторы модерации и поисковые модели, не для чата
    const lowerId = m.id.toLowerCase();
    if (lowerId.includes('safeguard') || lowerId.includes('-search')) {
      return null;
    }

    if (isCodeUnfit(m.id)) {
      return null;
    }

    // Модели старше 2 лет (если поле created указано)
    if (m.created && Number(m.created) < minCreatedSec) {
      return null;
    }
  }

  const inputModalities = m.architecture?.input_modalities;
  const vision = Array.isArray(inputModalities)
    ? inputModalities.includes('image')
    : undefined;

  return {
    id: m.id,
    name: m.name || m.id,
    provider: 'openrouter',
    contextLength: m.context_length,
    free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0,
    vision
  };
}

/**
 * Загрузить и отфильтровать список моделей OpenRouter
 *
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number }>>}
 */
export async function fetchOpenRouterModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];

  const minCreatedSec = (Date.now() - MAX_MODEL_AGE_MS) / 1000;
  const filtered = [];
  for (const m of rawList) {
    const entry = toModelEntry(m, minCreatedSec);
    if (entry) {
      filtered.push(entry);
    }
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
      free: true,
      vision: undefined
    });
  }

  return filtered;
}
