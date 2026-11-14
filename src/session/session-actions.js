/**
 * @fileoverview Действия сессии без консольного вывода (модели, уровень рассуждений, авторизация)
 */

import { loadConfig, saveConfig } from './config.js';
import { getProvider, getProviderKey, detectProviderForModel } from '../llm/providers.js';
import { findModel } from '../models/catalog.js';
import { checkOllamaServer } from '../models/ollama.js';
import { getUnavailableReason, UNAVAILABLE_REASONS } from '../models/status.js';
import { fetchKeyInfo, getModelContextLength } from '../llm/modelInfo.js';

/**
 * Переключает модель сессии с проверкой наличия ключа провайдера.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} modelId - Идентификатор модели
 * @param {string} [providerId] - Идентификатор провайдера (если опущен, определяется автоматически)
 * @returns {Promise<{ ok: boolean, message: string, needsLogin?: string }>}
 */
export async function selectModel(session, modelId, providerId) {
  let cleanId = String(modelId || '').trim();
  let provId = providerId;

  if (!provId) {
    if (cleanId.startsWith('ollama/') || cleanId.startsWith('ollama:')) {
      provId = 'ollama';
      cleanId = cleanId.replace(/^ollama[\/:]/, '');
    } else if (cleanId.toLowerCase() === 'ollama') {
      provId = 'ollama';
      cleanId = session.model && session.provider === 'ollama' ? session.model : '';
      if (!cleanId) {
        return { ok: false, message: 'Укажите модель Ollama: /model ollama/<модель>' };
      }
    } else {
      provId = detectProviderForModel(cleanId);
    }
  }

  if (!cleanId) {
    return { ok: false, message: 'Не указан идентификатор модели' };
  }

  const provider = getProvider(provId);
  const unavailable = findModel(cleanId)?.unavailable || getUnavailableReason(provider.id, cleanId);
  if (unavailable) {
    return { ok: false, message: `Модель ${cleanId} ${UNAVAILABLE_REASONS[unavailable]} — выберите другую` };
  }
  const config = loadConfig();
  const key = getProviderKey(provider.id, config) || (session.provider === provider.id ? session.apiKey : '');

  if (!key && !provider.local) {
    return {
      ok: false,
      needsLogin: provider.id,
      message: `Для модели ${cleanId} требуется ключ ${provider.title}.`
    };
  }

  session.provider = provider.id;
  session.apiKey = key || (provider.local ? 'ollama' : '');
  session.model = cleanId;
  session.lastRoutedModel = '';
  session.ollamaRuntimeContext = undefined;

  const currentModels = config.models || {};
  saveConfig({
    provider: provider.id,
    model: cleanId,
    models: { ...currentModels, [provider.id]: cleanId }
  });

  const cached = findModel(cleanId);
  if (cached?.contextLength) {
    session.contextLength = cached.contextLength;
  } else {
    try {
      session.contextLength = await getModelContextLength(cleanId, provider.id, session.apiKey);
    } catch {}
  }

  return {
    ok: true,
    message: `Модель: ${cleanId} · ${provider.title}`
  };
}

/**
 * Устанавливает уровень рассуждений (reasoning effort) модели.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} value - Уровень рассуждений (auto, low, medium, high)
 * @returns {string} Текст результата
 */
export function setEffort(session, value) {
  const validEfforts = ['auto', 'low', 'medium', 'high'];
  const trimmed = String(value || '').trim().toLowerCase();

  if (!validEfforts.includes(trimmed)) {
    return `Неизвестный уровень рассуждений: "${trimmed}". Допустимые: auto, low, medium, high`;
  }

  session.reasoningEffort = trimmed;
  saveConfig({ reasoningEffort: trimmed });
  return `Уровень рассуждений: ${trimmed}`;
}

/**
 * Сохраняет API-ключ OpenRouter и обновляет сессию.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} key - API-ключ OpenRouter
 * @returns {string} Текст результата
 */
export function saveOpenRouterKey(session, key) {
  saveConfig({ apiKey: key });
  if (session.provider === 'openrouter') {
    session.apiKey = key;
    fetchKeyInfo(key, 'openrouter').then(info => {
      if (info) session.keyInfo = info;
    }).catch(() => {});
  }
  return 'Ключ OpenRouter успешно сохранен в ~/.config/duddy/config.json';
}

/**
 * Подключает локальный сервер Ollama с выбором запущенной или установленной модели.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function connectOllama(session) {
  const status = await checkOllamaServer();
  if (!status.running) {
    return {
      ok: false,
      message: `Ollama не найдена по адресу ${status.host}. Запустите: ollama serve`
    };
  }

  const chosen = status.runningModels[0] || status.models[0];
  if (!chosen) {
    return {
      ok: false,
      message: 'В Ollama нет моделей. Скачайте модель: ollama pull <модель>'
    };
  }

  const id = chosen.id;
  const selected = await selectModel(session, id, 'ollama');
  if (!selected.ok) return selected;
  return {
    ok: true,
    message: `Выбран локальный провайдер Ollama · модель: ${id}`
  };
}
