import chalk from 'chalk';

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function padLine(content, width) {
  const vis = stripAnsi(content).length;
  const pad = Math.max(0, width - vis);
  return chalk.hex('#334155')('│') + '  ' + content + ' '.repeat(pad) + '  ' + chalk.hex('#334155')('│');
}

export function printBanner({ model = 'openrouter/free', hasKey = false, temperature = 0.4, cwd = process.cwd() } = {}) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let prettyPath = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const terminalCols = process.stdout.columns || 80;
  const maxCols = Math.max(72, Math.min(terminalCols - 4, 100));
  let width = 72;
  const needed = 50 + prettyPath.length;
  if (needed > width && maxCols > width) {
    width = Math.min(needed, maxCols);
  }

  const maxPathLen = width - 50;
  if (prettyPath.length > maxPathLen) {
    prettyPath = '...' + prettyPath.slice(-(maxPathLen - 3));
  }

  const borderTop = chalk.hex('#334155')('╭' + '─'.repeat(width + 4) + '╮');
  const borderBottom = chalk.hex('#334155')('╰' + '─'.repeat(width + 4) + '╯');

  // Cyberpunk Ice-Blue & Electric Cyan monochrome palette
  const l1 = chalk.bold.hex('#e0f7fa');
  const l2 = chalk.bold.hex('#67e8f9');
  const l3 = chalk.bold.hex('#38bdf8');
  const l4 = chalk.bold.hex('#0ea5e9');
  const l5 = chalk.bold.hex('#0284c7');
  const l6 = chalk.bold.hex('#0369a1');

  console.log();
  console.log(borderTop);
  console.log(padLine(l1('██████╗ ██╗   ██╗██████╗ ██████╗ ██╗   ██╗'), width));
  console.log(padLine(l2('██╔══██╗██║   ██║██╔══██╗██╔══██╗╚██╗ ██╔╝') + '  ' + chalk.bold.hex('#38bdf8')('DUDDY CLI') + chalk.dim(' V0.1.0'), width));
  console.log(padLine(l3('██║  ██║██║   ██║██║  ██║██║  ██║ ╚████╔╝ ') + '  ' + chalk.hex('#94a3b8')('Terminal AI Companion'), width));
  console.log(padLine(l4('██║  ██║██║   ██║██║  ██║██║  ██║  ╚██╔╝  ') + '  ' + chalk.hex('#64748b')('OpenRouter Engine'), width));
  console.log(padLine(l5('██████╔╝╚██████╔╝██████╔╝██████╔╝   ██║   ') + '  ' + chalk.hex('#64748b')('path: ') + chalk.hex('#38bdf8')(prettyPath), width));
  console.log(padLine(l6('╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝    ╚═╝   '), width));
  console.log(borderBottom);
  console.log();
}
