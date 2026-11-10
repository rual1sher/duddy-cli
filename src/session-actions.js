/**
 * @fileoverview Действия сессии без консольного вывода (модели, авторизация, статистика)
 */

import chalk from 'chalk';
import { paint } from './theme.js';
import { loadConfig, saveConfig } from './config.js';
import { PROVIDERS, getProvider, getProviderKey, detectProviderForModel } from './providers.js';
import { findModel, clearCatalogCache, catalogCache } from './models/catalog.js';
import { validateGoogleKey } from './models/google.js';
import { validateXaiKey } from './models/xai.js';
import { checkOllamaServer } from './models/ollama.js';
import { getUnavailableReason, UNAVAILABLE_REASONS } from './models/status.js';
import { fetchKeyInfo, getModelContextLength } from './llm/modelInfo.js';
import { MAX_HISTORY_TURNS } from './history.js';
import { readLimits } from './models/limits.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/update', desc: 'Обновить Duddy до последней версии' },
  { cmd: '/voice', desc: 'Голосовой ввод или авто-озвучка (/voice on/off, Ctrl+S)' },
  { cmd: '/model', desc: 'Список моделей ваших провайдеров с поиском' },
  { cmd: '/effort', desc: 'Уровень рассуждений модели: low / medium / high' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter, Google AI Studio или xAI' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/context', desc: 'Заполнение окна контекста и истории диалога' },
  { cmd: '/usage', desc: 'Лимиты моделей и расход токенов' },
  { cmd: '/theme', desc: 'Выбрать цветовую тему' },
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
  session.ollamaRuntimeContext = undefined;

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

function makeProgressBar(percent, width = 16) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;

  let color = paint('success');
  if (p >= 80) color = paint('error');
  else if (p >= 50) color = paint('warning');

  return color('█'.repeat(filled)) + paint('border')('░'.repeat(empty)) + ' ' + color((p + '%').padStart(4));
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

export const LIMIT_HINTS = {
  openrouter: 'лимита на модель нет: бесплатные делят общий лимит, платные списывают баланс',
  google: 'лимиты видны только в AI Studio, здесь они появятся после отказа 429',
  xai: 'лимиты видны только в xAI Console, здесь они появятся, если провайдер пришлёт их в ответе',
  ollama: 'локальные модели, лимитов нет'
};

/**
 * Форматирует метку времени в локальный формат ЧЧ:ММ
 *
 * @param {number} ts - Метка времени в миллисекундах
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Форматирует число с разделением тысяч по правилам русской локали
 *
 * @param {number|string|null|undefined} n - Число для форматирования
 * @returns {string}
 */
function formatCount(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

/**
 * Форматирует строку отказа 429 с пропуском отсутствующих полей
 *
 * @param {object} hit - Запись об отказе
 * @returns {string}
 */
function formatQuotaHit(hit) {
  if (!hit) return '';
  const parts = [];
  if (hit.limit != null && hit.metric) {
    parts.push(`лимит ${hit.limit} (${hit.metric})`);
  } else if (hit.limit != null) {
    parts.push(`лимит ${hit.limit}`);
  } else if (hit.metric) {
    parts.push(hit.metric);
  }
  if (hit.retryAfterSec != null) {
    parts.push(`повтор через ${hit.retryAfterSec} с`);
  }
  const timeStr = hit.at ? ` в ${formatTime(hit.at)}` : '';
  const details = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `Отказ 429${timeStr}${details}`;
}

/**
 * Разбирает ключ модели вида "<provider>:<modelId>" по первому двоеточию
 *
 * @param {string} key
 * @returns {{ provider: string, modelId: string }}
 */
function parseModelKey(key) {
  const idx = key.indexOf(':');
  if (idx === -1) {
    return { provider: '', modelId: key };
  }
  return {
    provider: key.slice(0, idx),
    modelId: key.slice(idx + 1)
  };
}

/**
 * Формирует строки информации о лимитах ключа OpenRouter (Daily Free и баланс)
 *
 * @param {object} [keyInfo] - Данные ключа OpenRouter
 * @returns {string[]}
 */
export function openRouterLimitLines(keyInfo) {
  const lines = [];
  if (keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = keyInfo.free_model_daily_requests;
    const freePct = Math.round((used / limit) * 100);
    const timeUntilReset = getTimeUntilMidnightUTC();
    lines.push(
      chalk.bold('  🌟 Дневной лимит бесплатных запросов (Daily Free):'),
      '  ' + makeProgressBar(freePct) + chalk.dim('  ·  ') + paint('muted')(`${used} из ${limit} запросов`) + paint('success')(` (${remaining} осталось)`),
      chalk.dim(`  ↳ Сбрасывается каждые сутки в 00:00 UTC (до сброса осталось: ${paint('accent')(timeUntilReset)})\n`)
    );
  }

  const dailySpend = Number(keyInfo?.usage_daily || 0).toFixed(2);
  const weeklySpend = Number(keyInfo?.usage_weekly || 0).toFixed(2);
  const monthlySpend = Number(keyInfo?.usage_monthly || 0).toFixed(2);

  if (keyInfo?.limit) {
    const totalSpend = Number(keyInfo.usage || 0);
    const keyLimit = Number(keyInfo.limit);
    const limitPct = Math.round((totalSpend / keyLimit) * 100);
    lines.push(
      chalk.bold('  💳 Баланс и лимиты ключа:'),
      '  ' + makeProgressBar(limitPct) + chalk.dim('  ·  ') + paint('muted')(`$${totalSpend.toFixed(2)} из $${keyLimit.toFixed(2)} лимита`) + paint('success')(` ($${Number(keyInfo.limit_remaining || 0).toFixed(2)} осталось)`)
    );
  }

  if (keyInfo) {
    lines.push(
      `  День: ${paint('accent')(`$${dailySpend}`)} · Неделя: ${paint('accent')(`$${weeklySpend}`)} · Месяц: ${paint('accent')(`$${monthlySpend}`)}`,
      ''
    );
  }

  return lines;
}

/**
 * Формирует строки отчёта о заполнении окна контекста и истории диалога.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<string[]>} Массив строк отчёта
 */
export async function contextLines(session) {
  if (!session.contextLength) {
    try {
      session.contextLength = await getModelContextLength(session.model, session.provider, session.apiKey);
    } catch {}
  }

  const turns = (session.messages || []).filter(m => m.role === 'user').length;
  const maxContext = session.contextLength || 1000000;
  const histPct = Math.round((turns / MAX_HISTORY_TURNS) * 100);

  const lines = [
    paint('accent').bold(`🧠 Контекст (${session.model})`),
    ''
  ];

  if (!session.lastUsage) {
    lines.push(
      chalk.dim('  Данных пока нет, они появятся после первого ответа модели'),
      chalk.dim(`  ↳ Размер окна контекста: ${paint('muted')(`${maxContext.toLocaleString('ru-RU')} tok`)}\n`)
    );
  } else {
    const lastTokens = session.lastUsage?.total_tokens ?? 0;
    const remainingTokens = Math.max(0, maxContext - lastTokens);
    const contextUsedPct = Math.min(100, Math.max(0, Math.round((lastTokens / maxContext) * 100)));

    lines.push(
      chalk.bold(`  🧠 Окно контекста (${paint('accent')(session.model)}):`),
      '  ' + makeProgressBar(contextUsedPct) + chalk.dim('  ·  ') +
        paint('muted')(`${lastTokens.toLocaleString('ru-RU')} из ${maxContext.toLocaleString('ru-RU')} tok`) +
        paint('success')(` (${remainingTokens.toLocaleString('ru-RU')} свободно)`),
      chalk.dim(`  ↳ Занято в текущем контексте: ${paint('warning').bold(lastTokens.toLocaleString('ru-RU'))} токенов (${contextUsedPct}%)`),
      chalk.dim(`  ↳ Осталось свободно в окне модели: ${paint('success').bold(remainingTokens.toLocaleString('ru-RU'))} токенов (${100 - contextUsedPct}%)\n`)
    );
  }

  lines.push(
    chalk.bold('  📦 Буфер памяти диалога (Context History):'),
    '  ' + makeProgressBar(histPct) + chalk.dim('  ·  ') + paint('muted')(`${turns} из ${MAX_HISTORY_TURNS} ходов`),
    chalk.dim(`  ↳ Запросов в текущем сеансе: ${chalk.bold(turns)}`)
  );

  return lines;
}

/**
 * Формирует строки отчёта о расходе токенов и лимитах моделей.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<string[]>} Массив форматированных строк с chalk
 */
export async function usageLines(session) {
  const config = loadConfig();
  const orKey = getProviderKey('openrouter', config) || (session.provider === 'openrouter' ? session.apiKey : '');
  let keyInfo = session.keyInfo;
  if (orKey) {
    try {
      const fresh = await fetchKeyInfo(orKey, 'openrouter');
      keyInfo = fresh ?? session.keyInfo;
      if (fresh) {
        session.keyInfo = fresh;
      }
    } catch {}
  }

  const limits = readLimits();
  const today = new Date().toISOString().slice(0, 10);
  const provider = getProvider(session.provider);

  const lines = [
    paint('accent').bold('📊 Лимиты и расход'),
    ''
  ];

  // Блок 1: Активная модель
  lines.push(chalk.bold(`Активная модель: ${session.model} · ${provider.title}`));

  const activeKey = `${session.provider}:${session.model}`;
  const activeRecord = limits.models[activeKey];
  if (activeRecord && activeRecord.day === today) {
    lines.push(`  Сегодня: запросов ${formatCount(activeRecord.requests)}, токенов ${formatCount(activeRecord.tokens)}`);
  } else {
    lines.push('  Сегодня запросов ещё не было');
  }

  const sessionModelTokens = session.modelUsage?.[session.model]?.totalTokens ?? 0;
  lines.push(`  За сессию: токенов ${formatCount(sessionModelTokens)}`);

  const rate = activeRecord?.rate;
  if (rate) {
    const timeStr = rate.at ? ` (на ${formatTime(rate.at)})` : '';
    if (rate.limitRequests != null && rate.remainingRequests != null) {
      lines.push(`  Лимит запросов: ${formatCount(rate.limitRequests)}, осталось ${formatCount(rate.remainingRequests)}${timeStr}`);
    } else if (rate.limitRequests != null) {
      lines.push(`  Лимит запросов: ${formatCount(rate.limitRequests)}${timeStr}`);
    } else if (rate.remainingRequests != null) {
      lines.push(`  Осталось запросов: ${formatCount(rate.remainingRequests)}${timeStr}`);
    }

    if (rate.limitTokens != null && rate.remainingTokens != null) {
      lines.push(`  Лимит токенов: ${formatCount(rate.limitTokens)}, осталось ${formatCount(rate.remainingTokens)}${timeStr}`);
    } else if (rate.limitTokens != null) {
      lines.push(`  Лимит токенов: ${formatCount(rate.limitTokens)}${timeStr}`);
    } else if (rate.remainingTokens != null) {
      lines.push(`  Осталось токенов: ${formatCount(rate.remainingTokens)}${timeStr}`);
    }
  }

  const recentHit = activeRecord?.hit && (Date.now() - activeRecord.hit.at < 24 * 60 * 60 * 1000);
  if (recentHit) {
    lines.push(`  ${formatQuotaHit(activeRecord.hit)}`);
  }

  if (session.provider === 'openrouter') {
    const orLines = openRouterLimitLines(keyInfo);
    if (orLines.length > 0) {
      lines.push(...orLines);
    }
  }

  const hasRate = Boolean(
    rate && (rate.limitRequests != null || rate.remainingRequests != null || rate.limitTokens != null || rate.remainingTokens != null)
  );
  if (!hasRate && !recentHit && session.provider !== 'openrouter') {
    const hint = LIMIT_HINTS[session.provider];
    if (hint) {
      lines.push(chalk.dim(`  ${hint}`));
    }
  }

  // Блок 2: Остальные модели
  function isConnected(id) {
    // У Ollama ключа нет: она «подключена», только если вернула модели
    if (getProvider(id).local) {
      return id === session.provider || (Array.isArray(catalogCache[id]) && catalogCache[id].length > 0);
    }
    return Boolean(getProviderKey(id, config) || (id === session.provider && session.apiKey));
  }

  const allProvKeys = Object.keys(PROVIDERS);
  const connectedProviders = [];
  if (session.provider && isConnected(session.provider)) {
    connectedProviders.push(session.provider);
  }
  for (const id of allProvKeys) {
    if (id !== session.provider && isConnected(id)) {
      connectedProviders.push(id);
    }
  }

  const providerGroups = [];

  for (const provId of connectedProviders) {
    const prov = getProvider(provId);
    const groupLines = [];

    if (provId === 'openrouter' && session.provider !== 'openrouter') {
      const orLines = openRouterLimitLines(keyInfo);
      if (orLines.length > 0) {
        groupLines.push(...orLines);
      }
    }

    const provModels = [];
    for (const [key, data] of Object.entries(limits.models)) {
      const { provider: mProv, modelId } = parseModelKey(key);
      if (mProv !== provId) continue;
      if (provId === session.provider && modelId === session.model) continue;

      const isToday = data.day === today;
      const reqToday = isToday ? (data.requests || 0) : 0;
      const tokToday = isToday ? (data.tokens || 0) : 0;
      const hasToday = isToday && (reqToday > 0 || tokToday > 0);
      const isHitRecent = data.hit && (Date.now() - data.hit.at < 24 * 60 * 60 * 1000);

      if (hasToday || isHitRecent) {
        provModels.push({
          modelId,
          data,
          reqToday,
          tokToday,
          isHitRecent
        });
      }
    }

    provModels.sort((a, b) => b.reqToday - a.reqToday);
    const topModels = provModels.slice(0, 10);

    for (const item of topModels) {
      let mLine = `    ${item.modelId}  запросов ${formatCount(item.reqToday)}, токенов ${formatCount(item.tokToday)}`;
      if (item.data.rate?.remainingRequests != null && item.data.rate?.limitRequests != null) {
        const timePart = item.data.rate.at ? ` на ${formatTime(item.data.rate.at)}` : '';
        mLine += ` · осталось ${formatCount(item.data.rate.remainingRequests)} из ${formatCount(item.data.rate.limitRequests)}${timePart}`;
      }
      if (item.isHitRecent) {
        mLine += ` · отказ 429 в ${formatTime(item.data.hit.at)}`;
      }
      groupLines.push(mLine);
    }

    if (Array.isArray(catalogCache[provId])) {
      const avail = catalogCache[provId].filter(m => !m.unavailable);
      const shown = new Set(topModels.map(m => m.modelId));
      if (provId === session.provider && session.model) {
        shown.add(session.model);
      }
      const k = avail.filter(m => !shown.has(m.id)).length;
      if (k > 0) {
        const hint = LIMIT_HINTS[provId] || '';
        groupLines.push(chalk.dim(`    Ещё моделей: ${formatCount(k)}, ${hint}`));
      }
    }

    if (groupLines.length > 0) {
      providerGroups.push({
        title: `  ${prov.title}:`,
        lines: groupLines
      });
    }
  }

  if (providerGroups.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Остальные модели:'));
    for (const group of providerGroups) {
      lines.push(group.title);
      lines.push(...group.lines);
    }
  }

  lines.push('');
  lines.push(`Всего за сессию: токенов ${formatCount(session.totalTokens)}`);
  lines.push(paint('subtle')('Счётчики учитывают только запросы через duddy, день считается по UTC.'));

  return lines;
}

/**
 * Формирует строки справки по слеш-командам и возможностям агента.
 *
 * @returns {string[]} Массив строк справки
 */
export function helpLines() {
  const lines = [
    paint('accent').bold('⚡ Доступные слеш-команды:')
  ];
  for (const item of AVAILABLE_COMMANDS) {
    lines.push(`  ${paint('warning')(item.cmd.padEnd(16))} ${chalk.dim('—')} ${item.desc}`);
  }
  lines.push('');
  lines.push(chalk.dim('💡 Подсказки:'));
  lines.push(chalk.dim('  / — команды'));
  lines.push(chalk.dim('  Ctrl+S — голосовой ввод (микрофон) или прервать речь'));
  lines.push(chalk.dim('  Shift+Tab — режим: обычный → правки без подтверждения → план → авто'));
  lines.push(chalk.dim('  Esc — прервать ответ / очистить ввод'));
  lines.push(chalk.dim('  Ctrl+C ×2 — выход'));
  lines.push('');
  lines.push(paint('accent').bold('🛠️  Файловые операции (AI Agent):'));
  lines.push(chalk.dim('  Попросите создать/прочитать/изменить файл — Duddy спросит подтверждение.'));
  return lines;
}
