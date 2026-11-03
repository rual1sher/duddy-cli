import chalk from 'chalk';
import ora from 'ora';
import { AnimatedTerminalRenderer, formatDuration } from './formatter.js';
import { recordRequest } from './models/limits.js';
import { theme, paint } from './theme.js';

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
      ? paint('warning')(' · долго: модель может ещё думать')
      : '';
    return paint('accent').bold(`Duddy ${phaseText}… `) +
      paint('subtle')(`${formatDuration(elapsed)} · ${modelLabel()}`) +
      slowWarning +
      paint('subtle')(' · Ctrl+C — прервать');
  };

  let spinner = ora({
    text: spinnerText(),
    color: 'cyan',
    spinner: 'dots12',
    // ora с discardStdin переводит stdin в raw-режим, а stdin-discarder из-за prependListener не запускает чтение свежего stdin — Ctrl+C тогда не доходит как SIGINT.
    discardStdin: false
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
        process.stdout.write(paint('border')('\n╭─ ') + paint('accent').bold('✦ Duddy') + paint('faint')(` [${modelLabel()}] `) + paint('border')('─'.repeat(26)) + '\n');
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
      console.log(paint('warning')(`⚠️  ${msg}`));
      if (wasSpinning) {
        spinner.text = spinnerText();
        spinner.start();
      }
    },

    onToolStart({ name }) {
      if (spinner && spinner.isSpinning) {
        spinner.stop();
      }
      console.log(paint('accent')(`\n⚙️  [Инструмент: ${chalk.bold(name)}]`));
    },

    onToolResult() {},

    onRequestDone({ usage, rateLimits }) {
      recordRequest(session.provider, session.model, usage, rateLimits);
    }
  };

  const log = (level, text) => {
    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }
    const line = '  ' + text;
    let colored = line;
    if (level === 'error') {
      colored = paint('error')(line);
    } else if (level === 'success') {
      colored = paint('success')(line);
    } else if (level === 'warn') {
      colored = paint('warning')(line);
    } else {
      // info
      if (text.includes('📖') || text.includes('📂')) {
        colored = paint('accent')(line);
      } else {
        colored = chalk.dim(line);
      }
    }
    console.log(colored);
  };

  const approve = async ({ name, relPath, preview, sensitive = false, scope = 'file' }) => {
    if (!interactive || !process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return 'no';
    }

    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }

    if (Array.isArray(preview) && preview.length > 0) {
      console.log();
      const t = theme();
      for (const item of preview) {
        if (item.kind === 'del') {
          const rawLine = `- ${item.text || ''}`;
          const truncated = rawLine.slice(0, 140);
          console.log('  ' + chalk.hex(t.diffDelFg).bgHex(t.diffDelBg)(truncated));
        } else if (item.kind === 'add') {
          const rawLine = `+ ${item.text || ''}`;
          const truncated = rawLine.slice(0, 140);
          console.log('  ' + chalk.hex(t.diffAddFg).bgHex(t.diffAddBg)(truncated));
        } else if (item.kind === 'warn') {
          console.log('  ' + paint('warning')(item.text));
        } else if (item.kind === 'info') {
          console.log(chalk.bold('  ' + item.text));
        } else {
          console.log('  ' + paint('muted')(item.text));
        }
      }
    }

    const question = sensitive
      ? `Применить ${name} для ${relPath}? [y] да · [n] нет: `
      : `Применить ${name} для ${relPath}? [y] да · [a] ${scope === 'command' ? 'да для этой команды' : 'да для всей сессии'} · [n] нет: `;
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

        const isEnter = str === '\r' || str === '\n';

        if (str === 'y' || str === 'Y' || (isEnter && !sensitive)) {
          choice = 'yes';
          label = 'да';
        } else if (!sensitive && (str === 'a' || str === 'A')) {
          choice = 'all';
          label = scope === 'command' ? 'да для этой команды' : 'да для всей сессии';
        } else if (str === 'n' || str === 'N' || str === '\u001b' || str === '\u0003' || isEnter) {
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
