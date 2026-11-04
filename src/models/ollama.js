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
