/** @fileoverview Клиент OpenAI для работы с провайдерами нейросетей */

import OpenAI from 'openai';
import { getProvider } from './providers.js';

/**
 * Создать OpenAI-совместимый клиент для указанного провайдера.
 * Своих таймаутов нет — остановка только по Esc (внешний AbortSignal).
 * Таймаут SDK 24 часа, чтобы SDK не обрывал запрос самостоятельно.
 *
 * @param {string} apiKey - API-ключ
 * @param {string} [providerId='openrouter'] - Идентификатор провайдера
 * @param {object} [options={}] - Дополнительные параметры
 * @param {Function} [options.onRequest] - Колбэк, вызываемый перед каждым HTTP-запросом
 * @returns {OpenAI}
 */
export function createClient(apiKey, providerId = 'openrouter', { onRequest } = {}) {
  const provider = getProvider(providerId);
  const fetchFn = typeof onRequest === 'function'
    ? (url, init) => { onRequest(); return globalThis.fetch(url, init); }
    : undefined;
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: apiKey,
    defaultHeaders: provider.headers || {},
    // Все повторы делает src/llm/retry.js; повторы SDK на 429 тратили лишние запросы дневного лимита OpenRouter
    maxRetries: 0,
    // Своих таймаутов нет; остановка только по Esc (внешний signal)
    timeout: 24 * 60 * 60 * 1000,
    ...(fetchFn ? { fetch: fetchFn } : {})
  });
}
