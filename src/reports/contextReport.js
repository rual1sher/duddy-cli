/**
 * @fileoverview Отчёт о заполнении окна контекста модели (/context)
 */

import chalk from 'chalk';
import { paint } from '../render/theme.js';
import { getModelContextLength } from '../llm/modelInfo.js';
import { makeProgressBar } from './reportFormat.js';

/**
 * Формирует строки отчёта о заполнении окна контекста.
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<string[]>} Массив строк отчёта
 */
export async function contextLines(session) {
  if (!session.contextLength) {
    try {
      session.contextLength = await getModelContextLength(
        session.model,
        session.provider,
        session.apiKey
      );
    } catch {}
  }

  const maxContext = session.contextLength || 1000000;

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
      '  ' +
        makeProgressBar(contextUsedPct) +
        chalk.dim('  ·  ') +
        paint('muted')(`${lastTokens.toLocaleString('ru-RU')} из ${maxContext.toLocaleString('ru-RU')} tok`) +
        paint('success')(` (${remainingTokens.toLocaleString('ru-RU')} свободно)`),
      chalk.dim(
        '  ↳ Занято в текущем контексте: ' +
        `${paint('warning').bold(lastTokens.toLocaleString('ru-RU'))} токенов (${contextUsedPct}%)`
      ),
      chalk.dim(
        '  ↳ Осталось свободно в окне модели: ' +
        `${paint('success').bold(remainingTokens.toLocaleString('ru-RU'))} токенов (${100 - contextUsedPct}%)\n`
      )
    );
  }

  return lines;
}
