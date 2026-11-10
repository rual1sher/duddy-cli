/**
 * @fileoverview Загрузка моделей локальной Ollama
 */

import { ollamaHost } from '../providers.js';

// Ollama на этой же машине отвечает мгновенно; долгое ожидание означает, что её нет
const OLLAMA_TIMEOUT_MS = 1500;

/**
 * Преобразовать модель из /api/tags в запись каталога или отфильтровать
 *
 * @param {object} m - Сырой объект модели Ollama
 * @returns {{ id: string, name: string, provider: string, contextLength?: number, vision: boolean, thinking: boolean, free: boolean, unavailable: string|null }|null}
 */
function toModelEntry(m) {
  const id = m?.name || m?.model;
  if (!id) return null;

  // Старые версии Ollama не сообщают возможности моделей, тогда считаем модель подходящей
  const caps = Array.isArray(m.capabilities) ? m.capabilities : null;
  if (caps && !caps.includes('completion')) return null;

  const size = m.details?.parameter_size;
  const contextLength = m.details?.context_length;

  return {
    id,
    name: size ? `${id} · ${size}` : id,
    provider: 'ollama',
    contextLength: typeof contextLength === 'number' ? contextLength : undefined,
    vision: Boolean(caps?.includes('vision')),
    thinking: caps ? caps.includes('thinking') : undefined,
    free: true,
    // Duddy работает через инструменты, без них модель не сможет выполнить ни одного действия
    unavailable: caps && !caps.includes('tools') ? 'notools' : null
  };
}

/**
 * Загрузить список моделей, установленных в локальной Ollama
 *
 * @returns {Promise<Array<{ id: string, name: string, provider: string, contextLength?: number, vision: boolean, thinking?: boolean, free: boolean, unavailable: string|null }>>}
 */
export async function fetchOllamaModels() {
  const host = ollamaHost();
  let res;
  try {
    res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Ollama не ответила за ${OLLAMA_TIMEOUT_MS / 1000}с (${host})`);
    }
    throw new Error(`Ollama не запущена (${host})`);
  }

  if (!res.ok) {
    throw new Error(`Ollama вернула ошибку HTTP ${res.status} (${host})`);
  }

  const json = await res.json();
  const raw = Array.isArray(json?.models) ? json.models : [];
  return raw
    .map(toModelEntry)
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/**
 * Получить реальный размер контекста запущенной в Ollama модели из /api/ps.
 * Возвращает context_length если это положительное число, иначе null. Никогда не выбрасывает исключений.
 *
 * @param {string} modelId - Имя или идентификатор модели
 * @returns {Promise<number|null>}
 */
export async function fetchOllamaRuntimeContext(modelId) {
  try {
    const res = await fetch(`${ollamaHost()}/api/ps`, {
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = Array.isArray(json?.models) ? json.models : [];
    const entry = raw.find(m => m?.name === modelId || m?.model === modelId);
    const len = entry?.context_length;
    return typeof len === 'number' && len > 0 ? len : null;
  } catch {
    return null;
  }
}

/**
 * Формирует текст предупреждения о скором заполнении памяти модели,
 * если токены запроса достигают или превышают 75% окна контекста Ollama.
 *
 * @param {number} promptTokens - Число токенов во входном запросе
 * @param {number} runtimeCtx - Размер рабочего окна контекста модели
 * @returns {string|null}
 */
export function ollamaContextWarning(promptTokens, runtimeCtx) {
  if (typeof runtimeCtx !== 'number' || runtimeCtx <= 0) return null;
  if (typeof promptTokens !== 'number' || promptTokens < runtimeCtx * 0.75) return null;
  return `Память модели почти заполнена: запрос занял ${promptTokens} из ${runtimeCtx} токенов, следующие шаги могут не поместиться. Увеличьте окно: OLLAMA_CONTEXT_LENGTH=32768 ollama serve (или Environment="OLLAMA_CONTEXT_LENGTH=32768" через sudo systemctl edit ollama).`;
}

/**
 * Получить список активных моделей из ollama ps (/api/ps)
 * @returns {Promise<Array<object>>}
 */
export async function fetchOllamaPs() {
  try {
    const res = await fetch(`${ollamaHost()}/api/ps`, {
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = Array.isArray(json?.models) ? json.models : [];
    return raw.map(toModelEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Проверить доступность сервера Ollama и получить список запущенных и установленных моделей
 * @returns {Promise<{ running: boolean, host: string, models: Array<object>, runningModels: Array<object>, error?: string }>}
 */
export async function checkOllamaServer() {
  const host = ollamaHost();
  try {
    const [tagsRes, psRes] = await Promise.allSettled([
      fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) }),
      fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) })
    ]);

    const tagsOk = tagsRes.status === 'fulfilled' && tagsRes.value.ok;
    const psOk = psRes.status === 'fulfilled' && psRes.value.ok;

    if (!tagsOk && !psOk) {
      return { running: false, host, models: [], runningModels: [] };
    }

    const tagsJson = tagsOk ? await tagsRes.value.json().catch(() => ({})) : {};
    const psJson = psOk ? await psRes.value.json().catch(() => ({})) : {};

    const rawTags = Array.isArray(tagsJson?.models) ? tagsJson.models : [];
    const rawPs = Array.isArray(psJson?.models) ? psJson.models : [];

    const runningModels = rawPs.map(toModelEntry).filter(Boolean);
    const installedModels = rawTags.map(toModelEntry).filter(Boolean);

    const seen = new Set();
    const models = [];
    for (const m of runningModels) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        models.push({ ...m, running: true });
      }
    }
    for (const m of installedModels) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        models.push(m);
      }
    }

    return { running: true, host, models, runningModels };
  } catch (err) {
    return { running: false, host, models: [], runningModels: [], error: err.message };
  }
}
