/**
 * @fileoverview Приветственный баннер Duddy CLI
 */

import chalk from 'chalk';
import fs from 'node:fs';
import { paint } from './theme.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const HINT = '/ — команды, Shift+Tab — режим';
export const SEP = '  ·  ';

/**
 * Формирует строки приветственного баннера для отображения в терминале.
 *
 * @param {object} [options]
 * @param {string} [options.model='openrouter/free'] - Идентификатор активной модели
 * @param {string} [options.provider='openrouter'] - Идентификатор активного провайдера
 * @param {boolean} [options.hasKey=false] - Признак наличия API-ключа
 * @param {string} [options.cwd=process.cwd()] - Текущая рабочая папка
 * @returns {string[]} Массив из 3 строк баннера
 */
export function bannerLines({
  model = 'openrouter/free',
  provider = 'openrouter',
  hasKey = false,
  cwd = process.cwd()
} = {}) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let prettyPath = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const terminalCols = process.stdout.columns || 80;
  const minColsForHint = 2 + 10 + SEP.length + HINT.length;

  let line3Content;
  if (terminalCols >= minColsForHint) {
    const maxPathLen = terminalCols - 2 - SEP.length - HINT.length;
    if (prettyPath.length > maxPathLen) {
      prettyPath = maxPathLen <= 1 ? '…' : '…' + prettyPath.slice(-(maxPathLen - 1));
    }
    line3Content = prettyPath + SEP + HINT;
  } else {
    const maxPathLen = Math.max(1, terminalCols - 2);
    if (prettyPath.length > maxPathLen) {
      prettyPath = maxPathLen <= 1 ? '…' : '…' + prettyPath.slice(-(maxPathLen - 1));
    }
    line3Content = prettyPath;
  }

  const modelInfo = hasKey
    ? paint('muted')(model)
    : paint('warning')('ключ не задан — выполните /login');

  const line2 = '  ' + paint('accent').bold('Duddy') + ' ' + chalk.dim('v' + pkg.version) + '  ' + modelInfo;
  const line3 = '  ' + paint('subtle')(line3Content);

  return ['', line2, line3];
}
