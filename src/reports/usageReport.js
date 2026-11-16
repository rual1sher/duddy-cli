/**
 * @fileoverview Отчёты о лимитах и расходе токенов (/usage)
 */

import chalk from 'chalk';
import { paint } from '../render/theme.js';
import { loadConfig } from '../session/config.js';
import { getProviderKey } from '../llm/providers.js';
import { fetchKeyInfo } from '../llm/modelInfo.js';
import { readLimits } from '../models/limits.js';
import { plural } from '../render/toolDisplay.js';
import {
  makeProgressBar,
  getTimeUntilMidnightUTC,
  formatCount,
  formatQuotaHit
} from './reportFormat.js';

export const LIMIT_HINTS = {
  ollama: 'локальные модели, лимитов нет'
};

/**
 * Формирует строки информации о лимитах ключа OpenRouter (Daily Free, баланс и траты).
 *
 * @param {object} [keyInfo] - Данные ключа OpenRouter
 * @returns {string[]} Массив строк отчёта
 */
export function openRouterLimitLines(keyInfo) {
  const lines = [];
  if (keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = keyInfo.free_model_daily_requests;
    const shownUsed = Math.min(used, limit);
    const pct = limit > 0 ? Math.round((shownUsed / limit) * 100) : 0;
    const statusTail = remaining > 0
      ? ` · осталось ${remaining}`
      : paint('error')(' · лимит исчерпан');
    const resetTail = ` · сброс через ${getTimeUntilMidnightUTC()}`;
    lines.push(
      `  Бесплатные запросы OpenRouter за день: ${makeProgressBar(pct)}  ` +
        `${shownUsed} из ${limit}${statusTail}${resetTail}`
    );
    if (remaining <= 0 && limit < 1000) {
      lines.push(
        chalk.dim('  ↳ лимит общий для всех :free моделей; после покупки $10 кредитов — 1000 запросов в день')
      );
    }
  }

  if (keyInfo?.limit) {
    const totalSpend = Number(keyInfo.usage || 0);
    const keyLimit = Number(keyInfo.limit);
    const pct = keyLimit > 0 ? Math.round((totalSpend / keyLimit) * 100) : 0;
    lines.push(
      `  Баланс: ${makeProgressBar(pct)}  $${totalSpend.toFixed(2)} из $${keyLimit.toFixed(2)}`
    );
  }

  const monthly = Number(keyInfo?.usage_monthly || 0);
  if (monthly > 0) {
    const dailySpend = Number(keyInfo?.usage_daily || 0).toFixed(2);
    const monthlySpend = monthly.toFixed(2);
    lines.push(
      `  Потрачено: $${dailySpend} сегодня · $${monthlySpend} за месяц`
    );
  }

  return lines;
}

/**
 * Форматирует сторону лимитов из заголовков (запросы или токены)
 *
 * @param {number|null} remaining - Оставшееся количество
 * @param {number|null} limit - Общий лимит
 * @param {string} unit - Единица измерения ("запросов" или "токенов")
 * @returns {string|null}
 */
function formatRateSide(remaining, limit, unit) {
  if (remaining != null && limit != null) {
    return `${formatCount(remaining)} из ${formatCount(limit)} ${unit}`;
  }
  if (remaining != null) {
    return `${formatCount(remaining)} ${unit}`;
  }
  if (limit != null) {
    return `из ${formatCount(limit)} ${unit}`;
  }
  return null;
}

/**
 * Формирует строки отчёта о расходе токенов и лимитах активной модели.
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

  const lines = [
    paint('accent').bold(`📊 Лимиты · ${session.model}`),
    ''
  ];

  let hasFreeDaily = false;
  let hasBalance = false;

  // Строки 2-4: лимиты OpenRouter
  if (session.provider === 'openrouter' && keyInfo) {
    hasFreeDaily = Boolean(keyInfo.free_model_daily_requests);
    hasBalance = Boolean(keyInfo.limit);
    const orLines = openRouterLimitLines(keyInfo);
    if (orLines.length > 0) {
      lines.push(...orLines);
    }
  }

  const activeKey = `${session.provider}:${session.model}`;
  const activeRecord = limits.models[activeKey];

  // Строка 5: Лимиты из заголовков (activeRecord.rate)
  let hasRate = false;
  const rate = activeRecord?.rate;
  if (rate) {
    const reqPart = formatRateSide(rate.remainingRequests, rate.limitRequests, 'запросов');
    const tokPart = formatRateSide(rate.remainingTokens, rate.limitTokens, 'токенов');
    const rateParts = [reqPart, tokPart].filter(Boolean);
    if (rateParts.length > 0) {
      hasRate = true;
      lines.push(`  Осталось: ${rateParts.join(' · ')}`);
    }
  }

  // Строка 6: Отказ 429 за последние 24 часа (только если строки 2 нет)
  const recentHit = activeRecord?.hit && (Date.now() - activeRecord.hit.at < 24 * 60 * 60 * 1000);
  const hasHit = Boolean(!hasFreeDaily && recentHit);
  if (hasHit) {
    lines.push(`  ${formatQuotaHit(activeRecord.hit)}`);
  }

  // Строка 7: Эта модель через Duddy сегодня
  if (activeRecord && activeRecord.day === today && activeRecord.requests) {
    const reqWord = plural(activeRecord.requests, 'запрос', 'запроса', 'запросов').split(' ')[1];
    lines.push(
      `  Эта модель через Duddy сегодня: ${formatCount(activeRecord.requests)} ${reqWord} · ` +
      `${formatCount(activeRecord.tokens)} токенов`
    );
  } else {
    lines.push('  Эта модель через Duddy сегодня: запросов не было');
  }

  // Строка 8: Хинт о лимитах для других провайдеров
  if (!hasFreeDaily && !hasBalance && !hasRate && !hasHit && session.provider !== 'openrouter') {
    const hint = LIMIT_HINTS[session.provider];
    if (hint) {
      lines.push(chalk.dim(`  ${hint}`));
    }
  }

  return lines;
}
