/**
 * @fileoverview Отчёты о лимитах и расходе токенов (/usage)
 */

import chalk from 'chalk';
import { paint } from '../render/theme.js';
import { loadConfig } from '../session/config.js';
import { PROVIDERS, getProvider, getProviderKey } from '../llm/providers.js';
import { catalogCache } from '../models/catalog.js';
import { fetchKeyInfo } from '../llm/modelInfo.js';
import { readLimits } from '../models/limits.js';
import {
  makeProgressBar,
  getTimeUntilMidnightUTC,
  formatTime,
  formatCount,
  formatQuotaHit,
  parseModelKey
} from './reportFormat.js';

export const LIMIT_HINTS = {
  openrouter: 'лимита на модель нет: бесплатные делят общий лимит, платные списывают баланс',
  ollama: 'локальные модели, лимитов нет'
};

/**
 * Формирует строки информации о лимитах ключа OpenRouter (Daily Free и баланс).
 *
 * @param {object} [keyInfo] - Данные ключа OpenRouter
 * @returns {string[]} Массив строк отчёта
 */
export function openRouterLimitLines(keyInfo) {
  const lines = [];
  if (keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = keyInfo.free_model_daily_requests;
    const freePct = Math.round((used / limit) * 100);
    const timeUntilReset = getTimeUntilMidnightUTC();
    lines.push(
      chalk.bold('  🌟 Дневной лимит бесплатных запросов (Daily Free):'),
      '  ' +
        makeProgressBar(freePct) +
        chalk.dim('  ·  ') +
        paint('muted')(`${used} из ${limit} запросов`) +
        paint('success')(` (${remaining} осталось)`),
      chalk.dim(
        `  ↳ Сбрасывается каждые сутки в 00:00 UTC (до сброса осталось: ${paint('accent')(timeUntilReset)})\n`
      )
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
      '  ' +
        makeProgressBar(limitPct) +
        chalk.dim('  ·  ') +
        paint('muted')(`$${totalSpend.toFixed(2)} из $${keyLimit.toFixed(2)} лимита`) +
        paint('success')(` ($${Number(keyInfo.limit_remaining || 0).toFixed(2)} осталось)`)
    );
  }

  if (keyInfo) {
    lines.push(
      `  День: ${paint('accent')(`$${dailySpend}`)} · ` +
      `Неделя: ${paint('accent')(`$${weeklySpend}`)} · ` +
      `Месяц: ${paint('accent')(`$${monthlySpend}`)}`,
      ''
    );
  }

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
    lines.push(
      `  Сегодня: запросов ${formatCount(activeRecord.requests)}, токенов ${formatCount(activeRecord.tokens)}`
    );
  } else {
    lines.push('  Сегодня запросов ещё не было');
  }

  const sessionModelTokens = session.modelUsage?.[session.model]?.totalTokens ?? 0;
  lines.push(`  За сессию: токенов ${formatCount(sessionModelTokens)}`);

  const rate = activeRecord?.rate;
  if (rate) {
    const timeStr = rate.at ? ` (на ${formatTime(rate.at)})` : '';
    if (rate.limitRequests != null && rate.remainingRequests != null) {
      lines.push(
        `  Лимит запросов: ${formatCount(rate.limitRequests)}, ` +
        `осталось ${formatCount(rate.remainingRequests)}${timeStr}`
      );
    } else if (rate.limitRequests != null) {
      lines.push(`  Лимит запросов: ${formatCount(rate.limitRequests)}${timeStr}`);
    } else if (rate.remainingRequests != null) {
      lines.push(`  Осталось запросов: ${formatCount(rate.remainingRequests)}${timeStr}`);
    }

    if (rate.limitTokens != null && rate.remainingTokens != null) {
      lines.push(
        `  Лимит токенов: ${formatCount(rate.limitTokens)}, ` +
        `осталось ${formatCount(rate.remainingTokens)}${timeStr}`
      );
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
    rate && (
      rate.limitRequests != null ||
      rate.remainingRequests != null ||
      rate.limitTokens != null ||
      rate.remainingTokens != null
    )
  );
  if (!hasRate && !recentHit && session.provider !== 'openrouter') {
    const hint = LIMIT_HINTS[session.provider];
    if (hint) {
      lines.push(chalk.dim(`  ${hint}`));
    }
  }

  // Блок 2: Остальные модели
  const isConnected = (id) => {
    if (getProvider(id).local) {
      return id === session.provider || (Array.isArray(catalogCache[id]) && catalogCache[id].length > 0);
    }
    return Boolean(getProviderKey(id, config) || (id === session.provider && session.apiKey));
  };

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
      if (mProv !== provId || (provId === session.provider && modelId === session.model)) {
        continue;
      }

      const isToday = data.day === today;
      const reqToday = isToday ? (data.requests || 0) : 0;
      const tokToday = isToday ? (data.tokens || 0) : 0;
      const hasToday = isToday && (reqToday > 0 || tokToday > 0);
      const isHitRecent = data.hit && (Date.now() - data.hit.at < 24 * 60 * 60 * 1000);

      if (hasToday || isHitRecent) {
        provModels.push({ modelId, data, reqToday, tokToday, isHitRecent });
      }
    }

    provModels.sort((a, b) => b.reqToday - a.reqToday);
    const topModels = provModels.slice(0, 10);

    for (const item of topModels) {
      let mLine = `    ${item.modelId}  запросов ${formatCount(item.reqToday)}, токенов ${formatCount(item.tokToday)}`;
      if (item.data.rate?.remainingRequests != null && item.data.rate?.limitRequests != null) {
        const timePart = item.data.rate.at ? ` на ${formatTime(item.data.rate.at)}` : '';
        mLine +=
          ` · осталось ${formatCount(item.data.rate.remainingRequests)} ` +
          `из ${formatCount(item.data.rate.limitRequests)}${timePart}`;
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
      providerGroups.push({ title: `  ${prov.title}:`, lines: groupLines });
    }
  }

  if (providerGroups.length > 0) {
    lines.push('', chalk.bold('Остальные модели:'));
    for (const group of providerGroups) {
      lines.push(group.title, ...group.lines);
    }
  }

  lines.push('', `Всего за сессию: токенов ${formatCount(session.totalTokens)}`);
  lines.push(paint('subtle')('Счётчики учитывают только запросы через duddy, день считается по UTC.'));

  return lines;
}
