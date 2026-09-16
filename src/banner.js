import chalk from 'chalk';

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function padLine(content, width) {
  const vis = stripAnsi(content).length;
  const pad = Math.max(0, width - vis);
  return chalk.hex('#334155')('│') + '  ' + content + ' '.repeat(pad) + '  ' + chalk.hex('#334155')('│');
}

export function printBanner({ model = 'openrouter/free', hasKey = false, temperature = 0.4 } = {}) {
  const width = 64;
  const borderTop = chalk.hex('#334155')('╭' + '─'.repeat(width + 4) + '╮');
  const borderMid = chalk.hex('#334155')('├' + '─'.repeat(width + 4) + '┤');
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
  console.log(padLine(l2('██╔══██╗██║   ██║██╔══██╗██╔══██╗╚██╗ ██╔╝') + '  ' + chalk.bold.hex('#38bdf8')('DUDDY AI') + chalk.dim(' v1.3.0'), width));
  console.log(padLine(l3('██║  ██║██║   ██║██║  ██║██║  ██║ ╚████╔╝ ') + '  ' + chalk.hex('#94a3b8')('Terminal AI Companion'), width));
  console.log(padLine(l4('██║  ██║██║   ██║██║  ██║██║  ██║  ╚██╔╝  ') + '  ' + chalk.hex('#64748b')('OpenRouter Engine'), width));
  console.log(padLine(l5('██████╔╝╚██████╔╝██████╔╝██████╔╝   ██║   '), width));
  console.log(padLine(l6('╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝    ╚═╝   '), width));
  console.log(borderMid);

  const keyBadge = hasKey
    ? chalk.hex('#10b981')('● Connected')
    : chalk.red('○ No Key (use /login)');

  console.log(padLine(
    chalk.hex('#94a3b8')('Model: ') + chalk.bold.hex('#38bdf8')(model) + '  ' +
    chalk.hex('#94a3b8')('Status: ') + keyBadge,
    width
  ));

  console.log(padLine(
    chalk.hex('#64748b')('Temp: ') + chalk.hex('#cbd5e1')(temperature) + chalk.hex('#475569')(' · ') +
    chalk.hex('#64748b')('Команды: ') + chalk.bold.hex('#38bdf8')('/help') + chalk.hex('#475569')(' · ') +
    chalk.hex('#64748b')('Автодополнение: ') + chalk.bold.hex('#38bdf8')('<Tab>'),
    width
  ));

  console.log(borderMid);
  console.log(padLine(
    chalk.hex('#38bdf8')('/model') + chalk.hex('#475569')(' · ') +
    chalk.hex('#38bdf8')('/copy') + chalk.hex('#475569')(' · ') +
    chalk.hex('#38bdf8')('/save') + chalk.hex('#475569')(' · ') +
    chalk.hex('#38bdf8')('/clear') + chalk.hex('#475569')(' · ') +
    chalk.hex('#38bdf8')('/system') + chalk.hex('#475569')(' · ') +
    chalk.hex('#38bdf8')('/exit'),
    width
  ));
  console.log(borderBottom);
  console.log();
}
