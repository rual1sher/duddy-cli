import {
  select as inqSelect,
  search as inqSearch,
  input as inqInput,
  password as inqPassword,
  confirm as inqConfirm,
  Separator
} from '@inquirer/prompts';
import readline from 'node:readline';
import chalk from 'chalk';

// Configure fast escape timeout (50ms) on process.stdin early
try {
  readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 50 });
} catch (e) {}

/**
 * Default theme for select prompt that displays ESC navigation hint
 */
const DEFAULT_SELECT_THEME = {
  style: {
    keysHelpTip: () => [
      chalk.bold('↑↓') + ' ' + chalk.dim('навигация'),
      chalk.bold('⏎') + ' ' + chalk.dim('выбрать'),
      chalk.bold('esc') + ' ' + chalk.dim('выйти')
    ].join(chalk.dim(' • '))
  }
};

/**
 * Wrapper for inquirer prompts to support cancelling via Escape key (and graceful Ctrl+C exit)
 * Returns null / false if cancelled via Esc or Ctrl+C (when cancelOnSigint is true).
 */
export function withEsc(promptFn, config, context = {}) {
  try {
    readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 50 });
  } catch (e) {}

  const ctx = { clearPromptOnDone: false, ...context };
  const promptPromise = promptFn(config, ctx);

  const onKeypress = (str, key) => {
    if (key && (key.name === 'escape' || (key.sequence === '\u001b' && !key.meta && !key.ctrl && !key.shift))) {
      ctx.clearPromptOnDone = true;
      if (typeof promptPromise.cancel === 'function') {
        promptPromise.cancel();
      }
    }
  };

  process.stdin.on('keypress', onKeypress);

  return promptPromise
    .then((answer) => answer)
    .catch((err) => {
      // CancelPromptError when promptPromise.cancel() is called on Escape
      if (err && (err.name === 'CancelPromptError' || err.message?.includes('canceled') || err.message?.includes('cancelled'))) {
        return false;
      }
      // ExitPromptError when user force closes with Ctrl+C (SIGINT)
      if (err && (err.name === 'ExitPromptError' || err.message?.includes('SIGINT') || err.message?.includes('force closed'))) {
        if (config?.cancelOnSigint) {
          return false;
        }
        console.log(chalk.dim('\n\nBye! 👋'));
        process.exit(0);
      }
      throw err;
    })
    .finally(() => {
      process.stdin.removeListener('keypress', onKeypress);
    });
}

/**
 * Select prompt with Esc-to-exit and custom Russian help tip
 */
export function select(config, context) {
  const theme = {
    ...DEFAULT_SELECT_THEME,
    ...config.theme,
    style: {
      ...DEFAULT_SELECT_THEME.style,
      ...config.theme?.style
    }
  };
  return withEsc(inqSelect, { ...config, theme }, context);
}

/**
 * Search prompt with Esc-to-exit and custom Russian help tip
 *
 * @param {object} config - Inquirer search config
 * @param {object} [context] - Execution context
 * @returns {Promise<any>}
 */
export function search(config, context) {
  const theme = {
    ...DEFAULT_SELECT_THEME,
    ...config.theme,
    style: {
      ...DEFAULT_SELECT_THEME.style,
      ...config.theme?.style
    }
  };
  return withEsc(inqSearch, { ...config, theme }, context);
}

/**
 * Input prompt with Esc-to-exit
 */
export function input(config, context) {
  return withEsc(inqInput, config, context);
}

/**
 * Password prompt with Esc-to-exit
 */
export function password(config, context) {
  return withEsc(inqPassword, config, context);
}

/**
 * Confirm prompt with Esc-to-exit
 */
export function confirm(config, context) {
  return withEsc(inqConfirm, config, context);
}

export { Separator };
