/** @fileoverview Получение информации о ключе API и лимитах контекста моделей */

import { ollamaHost } from './providers.js';

/**
 * Получить актуальную информацию о ключе и доступных лимитах/остатке
 *
 * @param {string} apiKey - API-ключ
 * @param {string} [provider='openrouter'] - Идентификатор провайдера
 * @returns {Promise<object|null>}
 */
export async function fetchKeyInfo(apiKey, provider = 'openrouter') {
  if (!apiKey || provider !== 'openrouter') return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/duddy-cli',
        'X-Title': 'Duddy CLI'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

const ollamaContextCache = {};
let modelsContextCache = null;

/**
 * Получить максимальное окно контекста (лимит токенов) для модели
 *
 * @param {string} [modelId=''] - Идентификатор модели
 * @param {string} [provider='openrouter'] - Идентификатор провайдера
 * @param {string} [apiKey=''] - API-ключ
 * @returns {Promise<number>}
 */
export async function getModelContextLength(modelId = '', provider = 'openrouter', apiKey = '') {
  if (provider === 'ollama') {
    if (ollamaContextCache[modelId]) {
      return ollamaContextCache[modelId];
    }
    try {
      const res = await fetch(`${ollamaHost()}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const json = await res.json();
        // Ключ зависит от архитектуры модели: llama.context_length, qwen2.context_length и т.п.
        const entry = Object.entries(json?.model_info || {})
          .find(([k, v]) => k.endsWith('.context_length') && typeof v === 'number');
        if (entry) {
          ollamaContextCache[modelId] = entry[1];
          return entry[1];
        }
      }
    } catch {}
    return 8192;
  }

  if (!modelsContextCache) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const json = await res.json();
        modelsContextCache = {};
        for (const m of json.data || []) {
          if (m.id && m.context_length) {
            modelsContextCache[m.id] = m.context_length;
          }
        }
      }
    } catch {}
  }

  if (modelsContextCache && modelsContextCache[modelId]) {
    return modelsContextCache[modelId];
  }

  const m = (modelId || '').toLowerCase();
  if (m.includes('gemini') || m.includes('gemma')) return 1000000;
  if (m.includes('free')) return 200000;
  if (m.includes('claude')) return 200000;
  if (m.includes('gpt-4.1') || m.includes('o3') || m.includes('o1')) return 1000000;
  if (m.includes('gpt-4') || m.includes('llama')) return 128000;
  if (m.includes('deepseek')) return 64000;
  return 1000000;
}
