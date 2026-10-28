import readline from 'node:readline';
import chalk from 'chalk';
import { printBanner } from './banner.js';
import { fetchKeyInfo, getModelContextLength } from './api.js';
import { runAgentTurn, MAX_HISTORY_TURNS } from './agent.js';
import { getProvider } from './providers.js';
import { formatDuration } from './formatter.js';
import {
  AVAILABLE_COMMANDS,
  handleHelpCommand,
  handleModelCommand,
  handleEffortCommand,
  handleLoginCommand,
  handleClearCommand,
  handleUsageCommand
} from './commands.js';

const COMMAND_LIST = AVAILABLE_COMMANDS.map(c => c.cmd);

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function rule() {
  const cols = process.stdout.columns || 80;
  return chalk.hex('#334155')('─'.repeat(cols));
}

export function renderStatusLine(session) {
  const cols = process.stdout.columns || 80;
  const provider = getProvider(session?.provider);
  const routedSuffix = (session?.lastRoutedModel && session.lastRoutedModel !== session.model)
    ? chalk.hex('#64748b')(' → ' + session.lastRoutedModel)
    : '';
  const effortSuffix = (session?.reasoningEffort && session.reasoningEffort !== 'auto')
    ? chalk.hex('#64748b')(` · ${session.reasoningEffort}`)
    : '';
  const left = chalk.bold.hex('#38bdf8')(session?.model || 'model') + routedSuffix + chalk.hex('#64748b')(' · ' + provider.title) + effortSuffix;

  const rightParts = [];
  if (session?.lastTurnMs) {
    rightParts.push(chalk.hex('#94a3b8')('⏱ ' + formatDuration(session.lastTurnMs)));
  }
  if (session?.lastUsage?.total_tokens) {
    const total = session.lastUsage.total_tokens;
    const tokFormatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    rightParts.push(chalk.hex('#10b981')(`${tokFormatted} tok`));

    if (session?.contextLength) {
      const remaining = Math.max(0, session.contextLength - total);
      let remFormatted;
      if (remaining >= 950_000) {
        remFormatted = `${Math.round(remaining / 1_000_000)}M`;
      } else if (remaining >= 1000) {
        remFormatted = `${Math.round(remaining / 1000)}k`;
      } else {
        remFormatted = `${remaining}`;
      }
      rightParts.push(chalk.dim(`осталось ${remFormatted}`));
    }
  }

  const right = rightParts.length > 0 ? rightParts.join(chalk.dim(' · ')) : chalk.dim('новый диалог');

  const leftStr = '  ' + left;
  const leftLen = stripAnsi(leftStr).length;
  const rightLen = stripAnsi(right).length;

  const targetWidth = cols - 1;
  const spacesCount = targetWidth - leftLen - rightLen;

  if (spacesCount >= 1) {
    return leftStr + ' '.repeat(spacesCount) + right;
  }

  const fallback = leftStr + chalk.dim(' · ') + right;
  if (stripAnsi(fallback).length <= targetWidth) {
    return fallback;
  }

  return leftStr;
}

let lastSigintTime = 0;

function askLine(session, history) {
  return new Promise((resolve) => {
    process.stdin.resume();

    const promptStr = chalk.bold.hex('#38bdf8')('› ');

    if (process.stdin.isTTY) {
      process.stdout.write(rule() + '\n');
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history,
      removeHistoryDuplicates: true,
      escapeCodeTimeout: 50
    });

    let selectedIndex = 0;
    let prevLine = '';
    let isSubmitting = false;
    let render = null;
    let onResize = null;

    if (process.stdin.isTTY) {
      const baseRefresh = rl._refreshLine.bind(rl);

      render = () => {
        if (isSubmitting) return;

        const stdout = rl.output;
        if (!stdout) return;

        if (rl.line !== prevLine) {
          prevLine = rl.line;
          selectedIndex = 0;
        }

        const isCommandMode = rl.line.startsWith('/') && !rl.line.includes(' ');
        const filtered = isCommandMode
          ? AVAILABLE_COMMANDS.filter(c => c.cmd.startsWith(rl.line))
          : [];

        if (filtered.length > 0) {
          if (selectedIndex < 0 || selectedIndex >= filtered.length) {
            selectedIndex = 0;
          }
        }

        baseRefresh();

        const cols = process.stdout.columns || 80;
        const promptLen = stripAnsi(promptStr).length;
        const endRow = Math.floor((promptLen + rl.line.length) / cols);
        const cur = rl.getCursorPos();

        const rowDiff = endRow - cur.rows;
        if (rowDiff > 0) {
          stdout.write(`\x1b[${rowDiff}B`);
        }

        const listLines = [];
        if (isCommandMode) {
          if (filtered.length > 0) {
            const prefixLen = 13;
            const maxDescLen = Math.max(0, cols - 1 - prefixLen);
            filtered.forEach((item, idx) => {
              let desc = item.desc || '';
              if (desc.length > maxDescLen) {
                desc = maxDescLen > 1 ? desc.slice(0, maxDescLen - 1) + '…' : desc.slice(0, maxDescLen);
              }
              if (idx === selectedIndex) {
                listLines.push(chalk.hex('#38bdf8')('› ') + chalk.bold.hex('#38bdf8')(item.cmd.padEnd(10)) + ' ' + chalk.hex('#94a3b8')(desc));
              } else {
                listLines.push('  ' + chalk.hex('#94a3b8')(item.cmd.padEnd(10)) + ' ' + chalk.dim(desc));
              }
            });
          } else {
            listLines.push(chalk.dim('  нет такой команды'));
          }
        }

        const panelLines = [rule(), ...(isCommandMode ? listLines : [renderStatusLine(session)])];

        for (const line of panelLines) {
          stdout.write('\n' + line);
        }

        const moveUp = panelLines.length + rowDiff;
        if (moveUp > 0) {
          stdout.write(`\x1b[${moveUp}A`);
        }
        stdout.write('\r');
        if (cur.cols > 0) {
          stdout.write(`\x1b[${cur.cols}C`);
        }
      };

      const originalTtyWrite = rl._ttyWrite.bind(rl);

      rl._ttyWrite = function(d, key) {
        const isCommandMode = rl.line.startsWith('/') && !rl.line.includes(' ');
        const filtered = isCommandMode
          ? AVAILABLE_COMMANDS.filter(c => c.cmd.startsWith(rl.line))
          : [];

        if (isCommandMode) {
          if (key && (key.name === 'escape' || key.sequence === '\x1b')) {
            rl.line = '';
            rl.cursor = 0;
            prevLine = '';
            selectedIndex = 0;
            render();
            return;
          }

          if (key && (key.name === 'up' || key.name === 'down')) {
            if (filtered.length > 0) {
              if (key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
              } else {
                selectedIndex = (selectedIndex + 1) % filtered.length;
              }
              render();
            }
            return;
          }

          if (key && key.name === 'tab') {
            if (filtered.length > 0) {
              const selectedCmd = filtered[selectedIndex].cmd;
              rl.line = selectedCmd;
              rl.cursor = selectedCmd.length;
              prevLine = selectedCmd;
              selectedIndex = 0;
              render();
            }
            return;
          }

          if (key && (key.name === 'return' || key.name === 'enter')) {
            if (filtered.length > 0) {
              const selectedCmd = filtered[selectedIndex].cmd;
              if (rl.line !== selectedCmd) {
                rl.line = selectedCmd;
                rl.cursor = selectedCmd.length;
                prevLine = selectedCmd;
              }
            }
            originalTtyWrite(d, key);
            if (!isSubmitting) {
              render();
            }
            return;
          }
        }

        originalTtyWrite(d, key);
        if (!isSubmitting) {
          render();
        }
      };

      onResize = () => {
        render();
      };
      process.stdout.on('resize', onResize);
    }

    rl.question(promptStr, (answer) => {
      isSubmitting = true;
      if (onResize) {
        process.stdout.removeListener('resize', onResize);
      }
      if (process.stdin.isTTY) {
        const cols = process.stdout.columns || 80;
        const promptLen = stripAnsi(promptStr).length;
        const endRow = Math.floor((promptLen + answer.length) / cols);
        process.stdout.write(`\x1b[${endRow + 2}A\r\x1b[J`);
        if (answer.trim()) {
          process.stdout.write(chalk.hex('#64748b')('› ') + chalk.hex('#e2e8f0')(answer) + '\n');
        }
      }
      rl.close();
      resolve(answer);
    });

    if (process.stdin.isTTY && render) {
      render();
    }

    rl.on('SIGINT', () => {
      isSubmitting = true;
      if (onResize) {
        process.stdout.removeListener('resize', onResize);
      }
      if (process.stdin.isTTY) {
        const cur = rl.getCursorPos();
        process.stdout.write(`\x1b[${cur.rows + 1}A\r\x1b[J`);
      }
      const now = Date.now();
      if (now - lastSigintTime < 2500) {
        rl.close();
        console.log(chalk.dim('\nBye! 👋'));
        process.exit(0);
      } else {
        lastSigintTime = now;
        rl.close();
        process.stdout.write('\n' + chalk.yellow('⚠️  Нажмите Ctrl+C ещё раз для выхода из Duddy\n'));
        resolve('');
      }
    });

    rl.once('close', () => {
      if (onResize) {
        process.stdout.removeListener('resize', onResize);
      }
    });
  });
}


export async function startRepl(session) {
  session.toolCtx = session.toolCtx || { autoApprove: !!session.autoApprove, canPrompt: true };
  session.totalTokens = session.totalTokens || 0;
  session.lastUsage = session.lastUsage || null;
  session.modelUsage = session.modelUsage || {};
  session.keyInfo = session.keyInfo || null;
  session.lastTurnMs = session.lastTurnMs || null;
  session.lastRoutedModel = session.lastRoutedModel || '';
  session.reasoningEffort = session.reasoningEffort || 'auto';

  getModelContextLength(session.model, session.provider, session.apiKey).then(len => {
    session.contextLength = len;
  }).catch(() => {});

  if (session.apiKey && !session.keyInfo) {
    fetchKeyInfo(session.apiKey, session.provider).then(info => {
      if (info) session.keyInfo = info;
    }).catch(() => {});
  }

  console.clear();
  printBanner({
    model: session.model,
    hasKey: !!session.apiKey,
    temperature: session.temperature ?? 0.4
  });

  if (!session.apiKey) {
    console.log(chalk.yellow('⚠️  API-ключ не найден!'));
    console.log(chalk.dim('Пожалуйста, выполните вход для начала работы (или запустите /login позже):\n'));
    await handleLoginCommand(session);
    console.log();
  }

  const inputHistory = [];

  while (true) {
    let rawInput = '';
    try {
      rawInput = await askLine(session, inputHistory);
    } catch (e) {
      // If error on input reading, log and keep loop alive instead of exiting
      console.error(chalk.red('Input error:'), e.message);
      continue;
    }

    if (rawInput === undefined || rawInput === null) {
      console.log(chalk.dim('\nBye! 👋'));
      process.exit(0);
    }

    const trimmed = rawInput.trim();
    if (!trimmed) continue;

    // If user enters just "/" or "/?" -> show command hints
    if (trimmed === '/' || trimmed === '/?') {
      handleHelpCommand();
      continue;
    }

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const [cmd, ...argsList] = trimmed.slice(1).split(' ');
      const args = argsList.join(' ');

      switch (cmd.toLowerCase()) {
        case 'help':
        case '?':
          handleHelpCommand();
          break;
        case 'model':
        case 'models':
        case 'm':
          await handleModelCommand(args, session);
          session.lastRoutedModel = '';
          getModelContextLength(session.model, session.provider, session.apiKey).then(len => {
            session.contextLength = len;
          }).catch(() => {});
          break;
        case 'effort':
        case 'think':
          await handleEffortCommand(args, session);
          break;
        case 'login':
        case 'auth':
        case 'key':
          await handleLoginCommand(session, args);
          break;
        case 'clear':
        case 'cls':
        case 'reset':
          handleClearCommand(session);
          session.lastRoutedModel = '';
          break;
        case 'usage':
        case 'stats':
          await handleUsageCommand(session);
          break;
        case 'exit':
        case 'quit':
        case 'q':
          console.log(chalk.dim('Bye! 👋'));
          process.exit(0);
          break;
        default: {
          const matched = COMMAND_LIST.find(c => c.startsWith(`/${cmd}`));
          if (matched) {
            console.log(chalk.yellow(`Unknown command /${cmd}. Did you mean ${chalk.bold(matched)}?`));
          } else {
            console.log(chalk.yellow(`Unknown command: /${cmd}. Type ${chalk.bold('/')} or ${chalk.bold('/help')} to see all commands.\n`));
          }
        }
      }
      continue;
    }

    // Normal chat flow: prepare messages
    const messagesToSend = [
      { role: 'system', content: session.systemPrompt },
      ...session.messages,
      { role: 'user', content: trimmed }
    ];

    const startTime = Date.now();
    const abortController = new AbortController();
    const onSigintStreaming = () => {
      abortController.abort();
    };
    process.once('SIGINT', onSigintStreaming);

    try {
      const { finalText, newMessages, lastUsage, elapsedMs } = await runAgentTurn({
        session,
        messages: messagesToSend,
        toolCtx: session.toolCtx,
        signal: abortController.signal
      });

      if (lastUsage) {
        session.lastUsage = lastUsage;
      }

      session.lastTurnMs = elapsedMs;

      // Refresh key status / limits in background
      if (session.apiKey) {
        fetchKeyInfo(session.apiKey, session.provider).then(info => {
          if (info) session.keyInfo = info;
        }).catch(() => {});
      }

      const durationStr = formatDuration(elapsedMs ?? (Date.now() - startTime));
      const tokFormatted = (lastUsage?.total_tokens ?? 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
      const tokenNote = lastUsage?.total_tokens ? chalk.hex('#f59e0b')(` · ${tokFormatted} tok`) : '';

      // Extract raw code blocks for instant copying / saving
      console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${durationStr}`) + tokenNote + '\n');

      // Обрезаем tool-контент > 4000 из предыдущих ходов перед добавлением нового хода
      for (const msg of session.messages) {
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 4000) {
          msg.content = msg.content.slice(0, 4000) + '\n...[результат обрезан в истории]';
        }
      }

      // Save to conversation history: user + newMessages
      session.messages.push({ role: 'user', content: trimmed });
      session.messages.push(...newMessages);

      if (!finalText || !finalText.trim()) {
        session.messages.push({ role: 'assistant', content: '(ход прерван: ответ не получен)' });
      }

      // Храним последние MAX_HISTORY_TURNS ходов пользователя
      const userIndices = [];
      for (let i = 0; i < session.messages.length; i++) {
        if (session.messages[i].role === 'user') {
          userIndices.push(i);
        }
      }
      if (userIndices.length > MAX_HISTORY_TURNS) {
        const cutoff = userIndices[userIndices.length - MAX_HISTORY_TURNS];
        session.messages = session.messages.slice(cutoff);
      }
    } catch (err) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        console.log(chalk.yellow(`\n\n⚠️  Генерация остановлена по Ctrl+C · ${formatDuration(Date.now() - startTime)}\n`));
      } else {
        console.log();
        console.error(chalk.red(`❌ Error: ${err.message}`));
        if (!session.apiKey) {
          console.log(chalk.yellow('💡 Подсказка: Введите API ключ с помощью команды /login'));
        } else if (session.provider === 'google') {
          const msg = (err.message || '').toLowerCase();
          if (msg.includes('503') || msg.includes('high demand') || err.code === 'FIRST_CHUNK_TIMEOUT') {
            console.log(chalk.yellow('💡 Модель перегружена у Google. Попробуйте /model gemini-3.5-flash (быстрая и стабильная)'));
          } else if (msg.includes('429')) {
            console.log(chalk.yellow('💡 Подсказка: Для этой модели исчерпан бесплатный лимит Google AI Studio — подождите или выберите другую через /model'));
          } else if (msg.includes('401') || msg.includes('403') || (msg.includes('400') && (msg.includes('api key') || msg.includes('api_key')))) {
            console.log(chalk.yellow('💡 Подсказка: Неверный ключ Google AI Studio — /login'));
          } else if (msg.includes('404') || msg.includes('not found') || msg.includes('unavailable')) {
            console.log(chalk.yellow(`💡 Подсказка: Модель "${session.model}" временно недоступна. Выберите другую через /model`));
          }
        } else {
          if (err.code === 'FIRST_CHUNK_TIMEOUT') {
            console.log(chalk.yellow('💡 Бесплатная модель не ответила. Повторите запрос или выберите другую через /model'));
          } else if (err.message.includes('401') || err.message.includes('Unauthorized')) {
            console.log(chalk.yellow('💡 Подсказка: Неверный API ключ. Введите актуальный ключ через /login'));
          } else if (err.message.includes('402') || err.message.includes('credits')) {
            console.log(chalk.yellow('💡 Подсказка: Для этой коммерческой модели нужен баланс на openrouter.ai/credits или выберите бесплатную модель через /model'));
          } else if (err.message.includes('free-models-per-day') || err.message.includes('429')) {
            console.log(chalk.yellow('💡 Подсказка: Дневной лимит бесплатных запросов OpenRouter исчерпан (50/день). Создайте новый ключ на openrouter.ai, дождитесь сброса или пополните баланс на $1.'));
          } else if (err.message.includes('404') || err.message.includes('No endpoints found') || err.message.includes('unavailable')) {
            console.log(chalk.yellow(`💡 Подсказка: Модель "${session.model}" временно недоступна. Выберите другую через /model`));
          }
        }
        console.log();
      }
    } finally {
      process.removeListener('SIGINT', onSigintStreaming);
    }

  }
}
