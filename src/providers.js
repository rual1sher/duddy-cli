/**
 * @fileoverview Провайдеры AI для Duddy CLI (OpenRouter, Google AI Studio и xAI)
 */

/**
 * @typedef {Object} ProviderConfig
 * @property {string} id - Идентификатор провайдера
 * @property {string} title - Отображаемое название провайдера
 * @property {string} baseURL - Базовый URL OpenAI-совместимого эндпоинта
 * @property {Record<string, string>} headers - Дополнительные HTTP-заголовки
 * @property {string} keyField - Поле ключа в файле конфигурации config.json
 * @property {string[]} envVars - Переменные окружения для поиска ключа
 * @property {string} keyUrl - Ссылка на страницу получения ключа
 * @property {string} defaultModel - Модель по умолчанию
 */

export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    title: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': 'https://github.com/duddy-cli',
      'X-Title': 'Duddy CLI'
    },
    keyField: 'apiKey',
    envVars: ['OPENROUTER_API_KEY'],
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'openrouter/free'
  },
  google: {
    id: 'google',
    title: 'Google AI Studio',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    headers: {},
    keyField: 'googleApiKey',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.5-flash'
  },
  xai: {
    id: 'xai',
    title: 'xAI',
    baseURL: 'https://api.x.ai/v1',
    headers: {},
    keyField: 'xaiApiKey',
    envVars: ['XAI_API_KEY'],
    keyUrl: 'https://console.x.ai',
    defaultModel: 'grok-4.7'
  }
};

/**
 * Получить конфигурацию провайдера по идентификатору.
 * При неизвестном id возвращает OpenRouter.
 *
 * @param {string} id - Идентификатор провайдера
 * @returns {ProviderConfig}
 */
export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.openrouter;
}

/**
 * Получить API-ключ провайдера: сначала проверяются переменные окружения,
 * затем соответствующее поле в объекте конфигурации.
 *
 * @param {string} providerId - Идентификатор провайдера
 * @param {object} [config={}] - Объект конфигурации пользователя
 * @returns {string} API-ключ или пустая строка
 */
export function getProviderKey(providerId, config = {}) {
  const provider = getProvider(providerId);
  for (const envVar of provider.envVars) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }
  return (config && config[provider.keyField]) || '';
}

/**
 * Автоматически определить провайдера по ID модели.
 * Возвращает 'google', если id начинается с 'gemini-' или 'gemma-' и не содержит '/',
 * 'xai', если id начинается с 'grok-' и не содержит '/',
 * иначе возвращает 'openrouter'.
 *
 * @param {string} modelId - Идентификатор модели
 * @returns {'google' | 'xai' | 'openrouter'}
 */
export function detectProviderForModel(modelId = '') {
  const m = String(modelId).toLowerCase().trim();
  if ((m.startsWith('gemini-') || m.startsWith('gemma-')) && !m.includes('/')) {
    return 'google';
  }
  if (m.startsWith('grok-') && !m.includes('/')) {
    return 'xai';
  }
  return 'openrouter';
}
