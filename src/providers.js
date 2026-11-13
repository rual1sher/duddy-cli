/**
 * @fileoverview Провайдеры AI для Duddy CLI (OpenRouter и локальная Ollama)
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
 * @property {boolean} [local] - Локальный провайдер без ключа (Ollama)
 */

const OLLAMA_DEFAULT_PORT = '11434';

/**
 * Адрес сервера Ollama из OLLAMA_HOST с нормализацией, как в самой Ollama:
 * схема по умолчанию http, 0.0.0.0 заменяется на 127.0.0.1, без схемы порт 11434.
 *
 * @param {string} [raw=process.env.OLLAMA_HOST] - Значение OLLAMA_HOST
 * @returns {string} Адрес вида http://127.0.0.1:11434 без завершающего слеша
 */
export function ollamaHost(raw = process.env.OLLAMA_HOST) {
  const value = String(raw || '').trim();
  if (!value) {
    return `http://localhost:${OLLAMA_DEFAULT_PORT}`;
  }
  try {
    // С явной схемой Ollama берёт её стандартный порт, без схемы — 11434
    const hasScheme = /^[a-z]+:\/\//i.test(value);
    const url = new URL(hasScheme ? value : `http://${value}`);
    if (url.hostname === '0.0.0.0') {
      url.hostname = '127.0.0.1';
    }
    if (!hasScheme && !url.port) {
      url.port = OLLAMA_DEFAULT_PORT;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return `http://localhost:${OLLAMA_DEFAULT_PORT}`;
  }
}

// OpenAI SDK требует непустой ключ, Ollama его не проверяет
const LOCAL_PROVIDER_KEY = 'ollama';

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
  ollama: {
    id: 'ollama',
    title: 'Ollama',
    baseURL: `${ollamaHost()}/v1/`,
    headers: {},
    keyField: '',
    envVars: [],
    keyUrl: 'https://ollama.com/download',
    defaultModel: '',
    local: true
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
 * затем соответствующее поле в объекте конфигурации. Локальному провайдеру
 * ключ не нужен, для него возвращается заглушка.
 *
 * @param {string} providerId - Идентификатор провайдера
 * @param {object} [config={}] - Объект конфигурации пользователя
 * @returns {string} API-ключ или пустая строка
 */
export function getProviderKey(providerId, config = {}) {
  const provider = getProvider(providerId);
  if (provider.local) {
    return LOCAL_PROVIDER_KEY;
  }
  for (const envVar of provider.envVars) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }
  return (config && config[provider.keyField]) || '';
}

/**
 * Автоматически определить провайдера по ID модели.
 * Возвращает 'ollama' для префиксов 'ollama/' и 'ollama:', иначе 'openrouter'.
 * Модели Ollama по имени не определить (id вида llama3.2:3b или user/model:tag),
 * их провайдер берётся из каталога.
 *
 * @param {string} modelId - Идентификатор модели
 * @returns {'ollama' | 'openrouter'}
 */
export function detectProviderForModel(modelId = '') {
  const m = String(modelId).toLowerCase().trim();
  if (m === 'ollama' || m.startsWith('ollama/') || m.startsWith('ollama:')) {
    return 'ollama';
  }
  return 'openrouter';
}
