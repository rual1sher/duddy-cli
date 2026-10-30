/**
 * @fileoverview Действия сессии без консольного вывода (модели, авторизация, статистика)
 */

import chalk from 'chalk';
import { loadConfig, saveConfig } from './config.js';
import { getProvider, getProviderKey, detectProviderForModel } from './providers.js';
import { findModel, clearCatalogCache } from './models/catalog.js';
import { validateGoogleKey } from './models/google.js';
import { validateXaiKey } from './models/xai.js';
import { getUnavailableReason, UNAVAILABLE_REASONS } from './models/status.js';
import { fetchKeyInfo, getModelContextLength } from './llm/modelInfo.js';
import { MAX_HISTORY_TURNS } from './history.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Список моделей ваших провайдеров с поиском' },
  { cmd: '/effort', desc: 'Уровень рассуждений модели: low / medium / high' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter, Google AI Studio или xAI' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/usage', desc: 'Показать статистику текущей сессии' },
  { cmd: '/help', desc: 'Показать список всех команд' },
  { cmd: '/exit', desc: 'Выйти из Duddy (или /quit)' }
];

/**
 * Переключает модель сессии с проверкой наличия ключа провайдера.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} modelId - Идентификатор модели
 * @param {string} [providerId] - Идентификатор провайдера (если опущен, определяется автоматически)
 * @returns {Promise<{ ok: boolean, message: string, needsLogin?: string }>}
 */
export async function selectModel(session, modelId, providerId) {
  const provId = providerId || detectProviderForModel(modelId);
  const provider = getProvider(provId);
  const unavailable = findModel(modelId)?.unavailable || getUnavailableReason(provider.id, modelId);
  if (unavailable) {
    return { ok: false, message: `Модель ${modelId} ${UNAVAILABLE_REASONS[unavailable]} — выберите другую` };
  }
  const config = loadConfig();
  const key = getProviderKey(provider.id, config) || (session.provider === provider.id ? session.apiKey : '');

  if (!key) {
    return {
      ok: false,
      needsLogin: provider.id,
      message: `Для модели ${modelId} требуется ключ ${provider.title}.`
    };
  }

  session.provider = provider.id;
  session.apiKey = key;
  session.model = modelId;
  session.lastRoutedModel = '';

  const currentModels = config.models || {};
  saveConfig({
    provider: provider.id,
    model: modelId,
    models: { ...currentModels, [provider.id]: modelId }
  });

  const cached = findModel(modelId);
  if (cached?.contextLength) {
    session.contextLength = cached.contextLength;
  } else {
    try {
      session.contextLength = await getModelContextLength(modelId, provider.id, key);
    } catch {}
  }

  return {
    ok: true,
    message: `Модель: ${modelId} · ${provider.title}`
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
 * Подключает провайдера по API-ключу с валидацией.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} providerId - Идентификатор провайдера
 * @param {string} key - API-ключ
 * @param {(key: string) => Promise<boolean>} validate - Функция валидации ключа
 * @returns {Promise<string>} Текст результата
 */
async function connectWithKey(session, providerId, key, validate) {
  await validate(key);
  clearCatalogCache(providerId);

  const config = loadConfig();
  const provider = getProvider(providerId);
  const targetModel = config.models?.[providerId] || provider.defaultModel;

  session.provider = providerId;
  session.apiKey = key;
  session.model = targetModel;
  session.lastRoutedModel = '';

  saveConfig({
    [provider.keyField]: key,
    provider: providerId,
    model: targetModel,
    models: { ...(config.models || {}), [providerId]: targetModel }
  });

  const cached = findModel(targetModel);
  if (cached?.contextLength) {
    session.contextLength = cached.contextLength;
  } else {
    try {
      session.contextLength = await getModelContextLength(targetModel, providerId, key);
    } catch {}
  }

  return `${provider.title} подключён. Модель: ${targetModel}`;
}

/**
 * Подключает Google AI Studio по API-ключу с валидацией.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} key - API-ключ Google AI Studio
 * @returns {Promise<string>} Текст результата
 */
export async function connectGoogle(session, key) {
  return connectWithKey(session, 'google', key, validateGoogleKey);
}

/**
 * Подключает xAI по API-ключу с валидацией.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} key - API-ключ xAI
 * @returns {Promise<string>} Текст результата
 */
export async function connectXai(session, key) {
  return connectWithKey(session, 'xai', key, validateXaiKey);
}

function makeProgressBar(percent, width = 16) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;

  let color = chalk.hex('#10b981');
  if (p >= 80) color = chalk.hex('#ef4444');
  else if (p >= 50) color = chalk.hex('#f59e0b');

  return color('█'.repeat(filled)) + chalk.hex('#334155')('░'.repeat(empty)) + ' ' + color((p + '%').padStart(4));
}

function getTimeUntilMidnightUTC() {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const diffMs = nextUTC.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}ч ${mins}м`;
}

/**
 * Формирует строки отчёта о расходе токенов и лимитах сессии.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<string[]>} Массив форматированных строк с chalk
 */
export async function usageLines(session) {
  if (!session.contextLength) {
    try {
      session.contextLength = await getModelContextLength(session.model, session.provider, session.apiKey);
    } catch {}
  }

  const turns = (session.messages || []).filter(m => m.role === 'user').length;
  const totalTokens = session.totalTokens ?? 0;
  const lastTokens = session.lastUsage?.total_tokens ?? 0;
  const maxContext = session.contextLength || 1000000;
  const remainingTokens = Math.max(0, maxContext - lastTokens);
  const contextUsedPct = Math.min(100, Math.max(0, Math.round((lastTokens / maxContext) * 100)));

  const histPct = Math.round((turns / MAX_HISTORY_TURNS) * 100);
  const provider = getProvider(session.provider);

  const lines = [
    chalk.bold.cyan(`📊 Мониторинг лимитов и токенов (${provider.title}):`),
    '',
    chalk.bold(`  🧠 Окно контекста активной модели (${chalk.hex('#38bdf8')(session.model)}):`),
    '  ' + makeProgressBar(contextUsedPct) + chalk.dim('  ·  ') +
      chalk.hex('#94a3b8')(`${lastTokens.toLocaleString('ru-RU')} из ${maxContext.toLocaleString('ru-RU')} tok`) +
      chalk.hex('#10b981')(` (${remainingTokens.toLocaleString('ru-RU')} свободно)`),
    chalk.dim(`  ↳ Занято в текущем контексте: ${chalk.bold.hex('#f59e0b')(lastTokens.toLocaleString('ru-RU'))} токенов (${contextUsedPct}%)`),
    chalk.dim(`  ↳ Осталось свободно в окне модели: ${chalk.bold.hex('#10b981')(remainingTokens.toLocaleString('ru-RU'))} токенов (${100 - contextUsedPct}%)\n`)
  ];

  if (session.keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = session.keyInfo.free_model_daily_requests;
    const freePct = Math.round((used / limit) * 100);
    const timeUntilReset = getTimeUntilMidnightUTC();
    lines.push(
      chalk.bold('  🌟 Дневной лимит бесплатных запросов (Daily Free):'),
      '  ' + makeProgressBar(freePct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${used} из ${limit} запросов`) + chalk.hex('#10b981')(` (${remaining} осталось)`),
      chalk.dim(`  ↳ Сбрасывается каждые сутки в 00:00 UTC (до сброса осталось: ${chalk.hex('#38bdf8')(timeUntilReset)})\n`)
    );
  }

  const dailySpend = Number(session.keyInfo?.usage_daily || 0).toFixed(2);
  const weeklySpend = Number(session.keyInfo?.usage_weekly || 0).toFixed(2);
  const monthlySpend = Number(session.keyInfo?.usage_monthly || 0).toFixed(2);

  if (session.keyInfo?.limit) {
    const totalSpend = Number(session.keyInfo.usage || 0);
    const keyLimit = Number(session.keyInfo.limit);
    const limitPct = Math.round((totalSpend / keyLimit) * 100);
    lines.push(
      chalk.bold('  💳 Баланс и лимиты ключа:'),
      '  ' + makeProgressBar(limitPct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`$${totalSpend.toFixed(2)} из $${keyLimit.toFixed(2)} лимита`) + chalk.hex('#10b981')(` ($${Number(session.keyInfo.limit_remaining || 0).toFixed(2)} осталось)`),
      `  День: ${chalk.hex('#38bdf8')(`$${dailySpend}`)} · Неделя: ${chalk.hex('#38bdf8')(`$${weeklySpend}`)} · Месяц: ${chalk.hex('#38bdf8')(`$${monthlySpend}`)}`,
      ''
    );
  }

  lines.push(
    chalk.bold('  📦 Буфер памяти диалога (Context History):'),
    '  ' + makeProgressBar(histPct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${turns} из ${MAX_HISTORY_TURNS} ходов`),
    chalk.dim(`  ↳ Запросов в текущем сеансе: ${chalk.bold(turns)}`),
    chalk.dim(`  ↳ Всего токенов обработано за сессию (счётчик): ${chalk.hex('#f59e0b')(`${totalTokens.toLocaleString('ru-RU')} tok`)}`)
  );

  return lines;
}

/**
 * Формирует строки справки по слеш-командам и возможностям агента.
 *
 * @returns {string[]} Массив строк справки
 */
export function helpLines() {
  const lines = [
    chalk.bold.cyan('⚡ Доступные слеш-команды:')
  ];
  for (const item of AVAILABLE_COMMANDS) {
    lines.push(`  ${chalk.yellow(item.cmd.padEnd(16))} ${chalk.dim('—')} ${item.desc}`);
  }
  lines.push('');
  lines.push(chalk.dim('💡 Подсказки:'));
  lines.push(chalk.dim('  / — команды'));
  lines.push(chalk.dim('  Esc — прервать ответ / очистить ввод'));
  lines.push(chalk.dim('  Ctrl+C ×2 — выход'));
  lines.push('');
  lines.push(chalk.bold.hex('#38bdf8')('🛠️  Файловые операции (AI Agent):'));
  lines.push(chalk.dim('  Попросите создать/прочитать/изменить файл — Duddy спросит подтверждение.'));
  return lines;
}
