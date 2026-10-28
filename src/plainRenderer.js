import chalk from 'chalk';
import ora from 'ora';
import { AnimatedTerminalRenderer, formatDuration } from './formatter.js';

/**
 * Создает текстовый рендерер терминала для хода агента.
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {object} options
 * @param {boolean} options.interactive - Доступен ли интерактивный ввод
 * @returns {{ events: object, toolCtxExtras: { log: Function, approve: Function }, finish: Function }}
 */
export function createPlainRenderer(session, { interactive }) {
  let routedModel = session.lastRoutedModel || '';
  const startedAt = Date.now();
  let phaseText = 'думает';
  let hasFirstText = false;
  let startedStreaming = false;
  let renderer = new AnimatedTerminalRenderer();

  const modelLabel = () =>
    routedModel && routedModel !== session.model
      ? `${session.model} → ${routedModel}`
      : session.model;

  const spinnerText = () => {
    const elapsed = Date.now() - startedAt;
    const slowWarning = (elapsed > 20000 && !hasFirstText)
      ? chalk.yellow(' · долго: провайдер может быть перегружен')
      : '';
    return chalk.bold.hex('#38bdf8')(`Duddy ${phaseText}… `) +
      chalk.hex('#64748b')(`${formatDuration(elapsed)} · ${modelLabel()}`) +
      slowWarning +
      chalk.hex('#64748b')(' · Ctrl+C — прервать');
  };

  let spinner = ora({
    text: spinnerText(),
    color: 'cyan',
    spinner: 'dots12'
  }).start();

  const ticker = setInterval(() => {
    if (spinner && spinner.isSpinning) {
      spinner.text = spinnerText();
    }
  }, 1000);

  const events = {
    onPhase(phase) {
      if (phase === 'thinking') {
        phaseText = 'думает';
        if (!startedStreaming && spinner && !spinner.isSpinning) {
          spinner.text = spinnerText();
          spinner.start();
        } else if (spinner && spinner.isSpinning) {
          spinner.text = spinnerText();
        }
      } else if (phase === 'reasoning') {
        phaseText = 'рассуждает';
        if (!startedStreaming && spinner && spinner.isSpinning) {
          spinner.text = spinnerText();
        }
      } else if (phase === 'tools') {
        phaseText = 'анализирует результат';
        if (spinner && spinner.isSpinning) {
          spinner.text = spinnerText();
        }
      }
    },

    onModel(id) {
      routedModel = id;
      if (spinner && spinner.isSpinning) {
        spinner.text = spinnerText();
      }
    },

    onText(delta) {
      if (!startedStreaming) {
        if (!delta.trim()) return;
        hasFirstText = true;
        if (spinner && spinner.isSpinning) {
          spinner.stop();
        }
        process.stdout.write(chalk.hex('#334155')('\n╭─ ') + chalk.bold.hex('#38bdf8')('✦ Duddy') + chalk.hex('#475569')(` [${modelLabel()}] `) + chalk.hex('#334155')('─'.repeat(26)) + '\n');
        startedStreaming = true;
      }
      renderer.push(delta);
    },

    async onStepEnd() {
      if (startedStreaming) {
        await renderer.flush();
        startedStreaming = false;
        renderer = new AnimatedTerminalRenderer();
      }
    },

    onWarning(msg) {
      const wasSpinning = spinner && spinner.isSpinning;
      if (wasSpinning) {
        spinner.stop();
      }
      console.log(chalk.yellow(`⚠️  ${msg}`));
      if (wasSpinning) {
        spinner.text = spinnerText();
        spinner.start();
      }
    },

    onToolStart({ name }) {
      if (spinner && spinner.isSpinning) {
        spinner.stop();
      }
      console.log(chalk.hex('#38bdf8')(`\n⚙️  [Инструмент: ${chalk.bold(name)}]`));
    },

    onToolResult() {}
  };

  const log = (level, text) => {
    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }
    const line = '  ' + text;
    let colored = line;
    if (level === 'error') {
      colored = chalk.red(line);
    } else if (level === 'success') {
      colored = chalk.green(line);
    } else if (level === 'warn') {
      colored = chalk.yellow(line);
    } else {
      // info
      if (text.includes('📖') || text.includes('📂')) {
        colored = chalk.hex('#38bdf8')(line);
      } else {
        colored = chalk.dim(line);
      }
    }
    console.log(colored);
  };

  const approve = async ({ name, relPath, preview }) => {
    if (!interactive || !process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return 'no';
    }

    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }

    if (Array.isArray(preview) && preview.length > 0) {
      console.log();
      for (const item of preview) {
        if (item.kind === 'del') {
          console.log(chalk.red('  - ' + item.text));
        } else if (item.kind === 'add') {
          console.log(chalk.green('  + ' + item.text));
        } else if (item.kind === 'warn') {
          console.log(chalk.yellow('  ' + item.text));
        } else if (item.kind === 'info') {
          console.log(chalk.bold('  ' + item.text));
        } else {
          console.log('  ' + item.text);
        }
      }
    }

    const question = `Применить ${name} для ${relPath}? [y] да · [a] да для всей сессии · [n] нет: `;
    process.stdout.write(question);

    const wasRaw = process.stdin.isRaw;

    return new Promise((resolve) => {
      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        try {
          process.stdin.setRawMode(wasRaw ?? false);
        } catch (e) {}
        process.stdin.pause();
      };

      const onData = (data) => {
        const str = data.toString('utf8');
        let choice = null;
        let label = '';

        if (str === 'y' || str === 'Y' || str === '\r' || str === '\n') {
          choice = 'yes';
          label = 'да';
        } else if (str === 'a' || str === 'A') {
          choice = 'all';
          label = 'да для всей сессии';
        } else if (str === 'n' || str === 'N' || str === '\u001b' || str === '\u0003') {
          choice = 'no';
          label = 'нет';
        } else {
          return;
        }

        cleanup();
        process.stdout.write(label + '\n');
        resolve(choice);
      };

      process.stdin.resume();
      process.stdin.setRawMode(true);
      process.stdin.on('data', onData);
    });
  };

  const finish = () => {
    clearInterval(ticker);
    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }
  };

  return {
    events,
    toolCtxExtras: {
      log,
      approve
    },
    finish
  };
}
