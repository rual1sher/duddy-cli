/**
 * @fileoverview Приветственный баннер Duddy CLI
 */

import chalk from 'chalk';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Формирует строки приветственного баннера для отображения в терминале.
 *
 * @param {object} [options]
 * @param {string} [options.model='openrouter/free'] - Идентификатор активной модели
 * @param {string} [options.provider='openrouter'] - Идентификатор активного провайдера
 * @param {boolean} [options.hasKey=false] - Признак наличия API-ключа
 * @param {string} [options.cwd=process.cwd()] - Текущая рабочая папка
 * @returns {string[]} Массив строк баннера
 */
export function bannerLines({ model = 'openrouter/free', provider = 'openrouter', hasKey = false, cwd = process.cwd() } = {}) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let prettyPath = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const terminalCols = process.stdout.columns || 80;
  const maxPathLen = Math.max(1, terminalCols - 30);
  if (prettyPath.length > maxPathLen) {
    prettyPath = '…' + prettyPath.slice(-(maxPathLen - 1));
  }

  // 5 letters — 5 shades from #67e8f9 to #0369a1, bold
  const c1 = chalk.bold.hex('#67e8f9');
  const c2 = chalk.bold.hex('#38bdf8');
  const c3 = chalk.bold.hex('#0ea5e9');
  const c4 = chalk.bold.hex('#0284c7');
  const c5 = chalk.bold.hex('#0369a1');

  const logoTop = c1('█▀▄') + ' ' + c2('█ █') + ' ' + c3('█▀▄') + ' ' + c4('█▀▄') + ' ' + c5('▀▄▀');
  const logoBottom = c1('█▄▀') + ' ' + c2('█▄█') + ' ' + c3('█▄▀') + ' ' + c4('█▄▀') + ' ' + c5(' █ ');

  const modelInfo = hasKey
    ? chalk.hex('#94a3b8')(model)
    : chalk.yellow('ключ не задан — выполните /login');

  const hints = '  ' +
    chalk.bold.hex('#94a3b8')('/') + chalk.dim(' — команды · ') +
    chalk.bold.hex('#94a3b8')('Esc') + chalk.dim(' — прервать · ') +
    chalk.bold.hex('#94a3b8')('Ctrl+C ×2') + chalk.dim(' — выход');

  return [
    '',
    '  ' + logoTop + '   ' + chalk.bold.hex('#38bdf8')('Duddy') + ' ' + chalk.dim(`v${pkg.version}`),
    '  ' + logoBottom + '   ' + modelInfo,
    ' '.repeat(24) + chalk.hex('#64748b')(prettyPath),
    '',
    hints,
    ''
  ];
}
