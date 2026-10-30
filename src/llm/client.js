/** @fileoverview Клиент OpenAI для работы с провайдерами нейросетей */

import OpenAI from 'openai';
import { getProvider } from '../providers.js';

/**
 * Создать OpenAI-совместимый клиент для указанного провайдера
 *
 * @param {string} apiKey - API-ключ
 * @param {string} [providerId='openrouter'] - Идентификатор провайдера
 * @returns {OpenAI}
 */
export function createClient(apiKey, providerId = 'openrouter') {
  const provider = getProvider(providerId);
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: apiKey,
    defaultHeaders: provider.headers || {},
    maxRetries: 1,
    // Наш таймаут первого чанка должен срабатывать раньше таймаута SDK (иначе SDK успеет начать повтор запроса)
    timeout: 660000
  });
}
