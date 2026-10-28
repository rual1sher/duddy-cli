import chalk from 'chalk';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function printBanner({ model = 'openrouter/free', hasKey = false, temperature = 0.4, cwd = process.cwd() } = {}) {
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
    chalk.bold.hex('#94a3b8')('Esc') + chalk.dim(' — отмена · ') +
    chalk.bold.hex('#94a3b8')('Ctrl+C') + chalk.dim(' — прервать ответ · ') +
    chalk.bold.hex('#94a3b8')('Ctrl+C ×2') + chalk.dim(' — выход');

  console.log();
  console.log('  ' + logoTop + '   ' + chalk.bold.hex('#38bdf8')('Duddy') + ' ' + chalk.dim(`v${pkg.version}`));
  console.log('  ' + logoBottom + '   ' + modelInfo);
  console.log(' '.repeat(24) + chalk.hex('#64748b')(prettyPath));
  console.log();
  console.log(hints);
  console.log();
}
