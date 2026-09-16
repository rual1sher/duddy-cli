import chalk from 'chalk';

export const BANNER_ART = `
  ____  _   _ ____  ____  __   __
 |  _ \\| | | |  _ \\|  _ \\ \\ \\ / /
 | | | | | | | | | | | | | \\ V / 
 | |_| | |_| | |_| | |_| |  | |  
 |____/ \\___/|____/|____/   |_|  
`;

export function printBanner(model, hasKey) {
  console.log(chalk.bold.cyan(BANNER_ART));
  console.log(
    chalk.dim('  🤖 ') +
    chalk.bold('Duddy') +
    chalk.dim(' - Your Terminal AI Assistant & DevOps Companion')
  );
  console.log();
  console.log(
    chalk.dim('  Model: ') + chalk.greenBright(model) +
    '  ' +
    chalk.dim('Key: ') + (hasKey ? chalk.green('✓ Connected') : chalk.red('✗ Not set (use /login)'))
  );
  console.log(
    chalk.dim('  Commands: ') +
    chalk.yellow('/model') + chalk.dim(' · ') +
    chalk.yellow('/login') + chalk.dim(' · ') +
    chalk.yellow('/clear') + chalk.dim(' · ') +
    chalk.yellow('/usage') + chalk.dim(' · ') +
    chalk.yellow('/help') + chalk.dim(' · ') +
    chalk.yellow('/exit')
  );
  console.log(chalk.dim('  💡 Tip: Type ') + chalk.cyan('/') + chalk.dim(' and press ') + chalk.cyan('<Tab>') + chalk.dim(' for autocomplete, or enter ') + chalk.cyan('/') + chalk.dim(' to see hints.'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log();
}
