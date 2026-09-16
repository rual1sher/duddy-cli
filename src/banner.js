import chalk from 'chalk';

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function padLine(content, width) {
  const vis = stripAnsi(content).length;
  const pad = Math.max(0, width - vis);
  return chalk.dim('│') + '  ' + content + ' '.repeat(pad) + '  ' + chalk.dim('│');
}

export function printBanner({ model = 'openrouter/free', hasKey = false, maxTokens = 750, temperature = 0.4 } = {}) {
  const width = 64;
  const borderTop = chalk.dim('╭' + '─'.repeat(width + 4) + '╮');
  const borderMid = chalk.dim('├' + '─'.repeat(width + 4) + '┤');
  const borderBottom = chalk.dim('╰' + '─'.repeat(width + 4) + '╯');

  const c1 = chalk.bold.hex('#9d4edd'); // Violet
  const c2 = chalk.bold.hex('#4361ee'); // Electric Blue
  const c3 = chalk.bold.hex('#00f5d4'); // Cyan
  const c4 = chalk.bold.hex('#06d6a0'); // Mint
  const c5 = chalk.bold.hex('#fee440'); // Yellow
  const c6 = chalk.bold.hex('#f72585'); // Magenta

  console.log();
  console.log(borderTop);
  console.log(padLine(c1('██████╗ ██╗   ██╗██████╗ ██████╗ ██╗   ██╗'), width));
  console.log(padLine(c2('██╔══██╗██║   ██║██╔══██╗██╔══██╗╚██╗ ██╔╝') + '  ' + chalk.bold.hex('#00f5d4')('DUDDY AI') + chalk.dim(' v1.2.0'), width));
  console.log(padLine(c3('██║  ██║██║   ██║██║  ██║██║  ██║ ╚████╔╝ ') + '  ' + chalk.dim('Terminal AI Companion'), width));
  console.log(padLine(c4('██║  ██║██║   ██║██║  ██║██║  ██║  ╚██╔╝  ') + '  ' + chalk.dim('Powered by OpenRouter'), width));
  console.log(padLine(c5('██████╔╝╚██████╔╝██████╔╝██████╔╝   ██║   '), width));
  console.log(padLine(c6('╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝    ╚═╝   '), width));
  console.log(borderMid);

  const keyBadge = hasKey
    ? chalk.hex('#06d6a0')('● Connected')
    : chalk.red('○ No Key (use /login)');

  console.log(padLine(
    chalk.bold('Model: ') + chalk.bold.hex('#00f5d4')(model) + '  ' +
    chalk.bold('Status: ') + keyBadge,
    width
  ));

  console.log(padLine(
    chalk.dim('Limit: ') + chalk.hex('#fee440')(maxTokens + ' tokens') + chalk.dim(' · ') +
    chalk.dim('Temp: ') + chalk.hex('#fee440')(temperature) + chalk.dim(' · ') +
    chalk.dim('Нажми ') + chalk.bold.cyan('<Tab>') + chalk.dim(' на ') + chalk.bold.cyan('/') + chalk.dim(' для команд'),
    width
  ));

  console.log(borderMid);
  console.log(padLine(
    chalk.hex('#00f5d4')('/model') + chalk.dim(' · ') +
    chalk.hex('#00f5d4')('/length') + chalk.dim(' · ') +
    chalk.hex('#00f5d4')('/clear') + chalk.dim(' · ') +
    chalk.hex('#00f5d4')('/system') + chalk.dim(' · ') +
    chalk.hex('#00f5d4')('/usage') + chalk.dim(' · ') +
    chalk.hex('#00f5d4')('/exit'),
    width
  ));
  console.log(borderBottom);
  console.log();
}
