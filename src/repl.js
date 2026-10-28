import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner } from './banner.js';
import { streamChatCompletion, fetchKeyInfo, getModelContextLength } from './api.js';
import { AnimatedTerminalRenderer } from './formatter.js';
import { AGENT_TOOLS, executeTool } from './tools.js';
import {
  AVAILABLE_COMMANDS,
  handleHelpCommand,
  handleModelCommand,
  handleLoginCommand,
  handleClearCommand,
  handleUsageCommand,
  handleSystemCommand
} from './commands.js';

const COMMAND_LIST = AVAILABLE_COMMANDS.map(c => c.cmd);

function completer(line) {
  const hits = COMMAND_LIST.filter(c => c.startsWith(line));
  return [hits.length ? hits : COMMAND_LIST, line];
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export function renderPromptFooter(session) {
  const cols = Math.max(40, Math.min(process.stdout.columns || 80, 110));
  const modelText = chalk.bold.hex('#38bdf8')(session.model);
  const left = modelText;

  const lastTokens = session.lastUsage?.total_tokens;
  const maxContext = session.contextLength;
  let right;

  if (lastTokens && maxContext) {
    const remaining = Math.max(0, maxContext - lastTokens);
    const remFormatted = remaining >= 1000 ? `${Math.round(remaining / 1000)}k` : remaining;
    const curFormatted = lastTokens >= 1000 ? `${(lastTokens / 1000).toFixed(1)}k` : lastTokens;
    right = chalk.hex('#10b981')(`${curFormatted} tok`) + chalk.dim(` · осталось ${remFormatted}`);
  } else if (lastTokens) {
    const curFormatted = lastTokens.toLocaleString('ru-RU').replace(/\s/g, ' ');
    right = chalk.hex('#f59e0b')(`${curFormatted} tok`);
  } else if (session.totalTokens) {
    const tokFormatted = session.totalTokens.toLocaleString('ru-RU').replace(/\s/g, ' ');
    right = chalk.hex('#f59e0b')(`${tokFormatted} tok за сессию`);
  } else {
    right = chalk.dim('новый диалог');
  }

  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;

  if (cols >= leftLen + rightLen + 10) {
    const fillCount = cols - leftLen - rightLen - 8;
    const fill = chalk.hex('#334155')('─'.repeat(Math.max(2, fillCount)));
    return chalk.hex('#334155')('╰─ ') + left + ' ' + fill + ' ' + right + chalk.hex('#334155')(' ─╯');
  } else {
    return chalk.hex('#334155')('╰─ ') + left + chalk.hex('#475569')(' · ') + right;
  }
}

let lastSigintTime = 0;

function askLine(session, history) {
  return new Promise((resolve) => {
    process.stdin.resume();

    const footer = renderPromptFooter(session);
    const promptStr = chalk.bold.hex('#38bdf8')('> ');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      history,
      escapeCodeTimeout: 50
    });

    let autocompleteIndex = -1;
    let filteredCommands = [];
    let isCommandMode = false;
    let isSubmitting = false;

    if (process.stdin.isTTY) {
      const originalRefreshLine = rl._refreshLine;
      rl._refreshLine = function() {
        if (isSubmitting) return;

        originalRefreshLine.call(rl);

        const currentLine = rl.line;
        if (currentLine.startsWith('/')) {
          filteredCommands = COMMAND_LIST.filter(c => c.startsWith(currentLine));
          isCommandMode = true;
        } else {
          filteredCommands = [];
          isCommandMode = false;
          autocompleteIndex = -1;
        }

        if (filteredCommands.length === 0) {
          autocompleteIndex = -1;
        } else if (autocompleteIndex >= filteredCommands.length) {
          autocompleteIndex = filteredCommands.length - 1;
        }

        const stdout = rl.output;
        if (!stdout) return;

        stdout.write('\x1b[J'); // clear down

        let linesDrawn = 0;
        if (isCommandMode && filteredCommands.length > 0) {
          filteredCommands.forEach((cmd, idx) => {
            if (idx === autocompleteIndex) {
              stdout.write('\n' + chalk.cyan(`> ${cmd}`));
            } else {
              stdout.write('\n' + `  ${cmd}`);
            }
            linesDrawn++;
          });
        }

        stdout.write('\n' + footer);
        linesDrawn++;

        if (linesDrawn > 0) {
          stdout.write(`\x1b[${linesDrawn}A`); // move back up
        }

        const cursorPos = rl.getCursorPos(); 
        stdout.write('\r');
        if (cursorPos.cols > 0) {
          stdout.write(`\x1b[${cursorPos.cols}C`); // move right to cursor
        }
      };

      const originalTtyWrite = rl._ttyWrite;
      rl._ttyWrite = function(d, key) {
        if (isCommandMode && filteredCommands.length > 0) {
          if (key && key.name === 'up') {
            autocompleteIndex = Math.max(0, autocompleteIndex - 1);
            rl._refreshLine();
            return;
          } else if (key && key.name === 'down') {
            if (autocompleteIndex === -1) {
              autocompleteIndex = 0;
            } else {
              autocompleteIndex = Math.min(filteredCommands.length - 1, autocompleteIndex + 1);
            }
            rl._refreshLine();
            return;
          } else if (key && (key.name === 'return' || key.name === 'enter')) {
            if (autocompleteIndex >= 0) {
               const selected = filteredCommands[autocompleteIndex];
               rl.line = selected;
               rl.cursor = selected.length;
               autocompleteIndex = -1;
               rl._refreshLine();
               // Fall through to let readline process the enter key
            }
          } else if (key && key.name === 'tab') {
             if (autocompleteIndex >= 0) {
               rl.line = filteredCommands[autocompleteIndex];
               rl.cursor = rl.line.length;
               rl._refreshLine();
               return;
             } else if (filteredCommands.length === 1) {
               rl.line = filteredCommands[0];
               rl.cursor = rl.line.length;
               rl._refreshLine();
               return;
             }
          }
        }
        originalTtyWrite.apply(rl, arguments);
      };
    }

    rl.question(promptStr, (answer) => {
      isSubmitting = true;
      if (process.stdin.isTTY) {
        process.stdout.write('\x1b[J'); // clear hints and old footer
      }
      rl.close();
      // Ensure footer is cleanly printed right beneath the user's entered input line
      process.stdout.write('\r' + footer + '\n');
      resolve(answer);
    });

    if (process.stdin.isTTY) {
      rl._refreshLine();
    }

    rl.on('SIGINT', () => {
      isSubmitting = true;
      if (process.stdin.isTTY) {
        process.stdout.write('\x1b[J');
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
  });
}


export async function startRepl(session) {
  session.totalTokens = session.totalTokens || 0;
  session.lastUsage = session.lastUsage || null;
  session.modelUsage = session.modelUsage || {};
  session.keyInfo = session.keyInfo || null;

  getModelContextLength(session.model).then(len => {
    session.contextLength = len;
  }).catch(() => {});

  if (session.apiKey && !session.keyInfo) {
    fetchKeyInfo(session.apiKey).then(info => {
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
    console.log(chalk.yellow('⚠️  No OpenRouter API key found!'));
    console.log(chalk.dim('Please enter your key to start (or run /login later):\n'));
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

    // Track in history for Up/Down arrows
    inputHistory.push(trimmed);

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
          getModelContextLength(session.model).then(len => {
            session.contextLength = len;
          }).catch(() => {});
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
          break;
        case 'usage':
        case 'stats':
          await handleUsageCommand(session);
          break;
        case 'system':
        case 'prompt':
          await handleSystemCommand(session);
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
    let spinner = ora({
      text: chalk.bold.hex('#38bdf8')('Duddy думает... ') + chalk.hex('#64748b')(`(${session.model})`),
      color: 'cyan',
      spinner: 'dots12'
    }).start();

    const abortController = new AbortController();
    const onSigintStreaming = () => {
      abortController.abort();
    };
    process.once('SIGINT', onSigintStreaming);

    let assistantText = '';
    let lastTurnUsage = null;
    const MAX_TOOL_TURNS = 10;
    let turn = 0;

    try {
      while (turn < MAX_TOOL_TURNS) {
        turn++;
        let startedStreaming = false;
        const renderer = new AnimatedTerminalRenderer();

        const { content, toolCalls, usage } = await streamChatCompletion({
          apiKey: session.apiKey,
          model: session.model,
          messages: messagesToSend,
          tools: AGENT_TOOLS,
          temperature: session.temperature ?? 0.4,
          signal: abortController.signal,
          onReasoning: () => {
            if (!startedStreaming && spinner.isSpinning) {
              spinner.text = chalk.bold.hex('#38bdf8')('Duddy рассуждает... ') + chalk.hex('#64748b')(`(${session.model})`);
            }
          },
          onChunk: (chunk) => {
            if (!startedStreaming) {
              if (!chunk.trim()) return;
              spinner.stop();
              process.stdout.write(chalk.hex('#334155')('\n╭─ ') + chalk.bold.hex('#38bdf8')('✦ Duddy') + chalk.hex('#475569')(` [${session.model}] `) + chalk.hex('#334155')('─'.repeat(26)) + '\n');
              startedStreaming = true;
            }
            renderer.push(chunk);
          }
        });

        if (usage) {
          lastTurnUsage = usage;
          const total = usage.total_tokens || 0;
          session.totalTokens = (session.totalTokens || 0) + total;
          if (!session.modelUsage[session.model]) {
            session.modelUsage[session.model] = { lastTokens: 0, totalTokens: 0 };
          }
          session.modelUsage[session.model].lastTokens = total;
          session.modelUsage[session.model].totalTokens += total;
        }

        if (startedStreaming) {
          await renderer.flush();
        }

        // If the model requested tool calls, execute them
        if (toolCalls && toolCalls.length > 0) {
          spinner.stop();

          // Add assistant tool_calls message
          messagesToSend.push({
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls
          });

          for (const call of toolCalls) {
            const funcName = call.function.name;
            let funcArgs = {};
            try {
              funcArgs = JSON.parse(call.function.arguments || '{}');
            } catch (err) {
              funcArgs = {};
            }

            console.log(chalk.hex('#38bdf8')(`\n⚙️  [Инструмент: ${chalk.bold(funcName)}]`));
            const toolResult = await executeTool(funcName, funcArgs);

            messagesToSend.push({
              role: 'tool',
              tool_call_id: call.id,
              name: funcName,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            });
          }

          // Restart spinner for next turn
          spinner = ora({
            text: chalk.bold.hex('#38bdf8')('Duddy анализирует результат... ') + chalk.hex('#64748b')(`(${session.model})`),
            color: 'cyan',
            spinner: 'dots12'
          }).start();

          continue;
        }

        // No tool calls: final response reached
        assistantText = content;
        break;
      }

      spinner.stop();

      if (lastTurnUsage) {
        session.lastUsage = lastTurnUsage;
      }

      // Refresh key status / limits in background
      if (session.apiKey) {
        fetchKeyInfo(session.apiKey).then(info => {
          if (info) session.keyInfo = info;
        }).catch(() => {});
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokFormatted = (lastTurnUsage?.total_tokens ?? 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
      const tokenNote = lastTurnUsage?.total_tokens ? chalk.hex('#f59e0b')(` · ${tokFormatted} tok`) : '';

      // Extract raw code blocks for instant copying / saving
      console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${elapsed}s`) + tokenNote + '\n');

      // Save to conversation history
      session.messages.push({ role: 'user', content: trimmed });
      if (assistantText) {
        session.messages.push({ role: 'assistant', content: assistantText });
      }

      // Keep last 20 messages for context limit safety
      if (session.messages.length > 20) {
        session.messages = session.messages.slice(-20);
      }
    } catch (err) {
      spinner.stop();
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        console.log(chalk.yellow('\n\n⚠️  Генерация остановлена по Ctrl+C\n'));
      } else {
        console.log();
        console.error(chalk.red(`❌ Error: ${err.message}`));
        if (!session.apiKey) {
          console.log(chalk.yellow('💡 Подсказка: Введите API ключ с помощью команды /login'));
        } else if (err.message.includes('401') || err.message.includes('Unauthorized')) {
          console.log(chalk.yellow('💡 Подсказка: Неверный API ключ. Введите актуальный ключ через /login'));
        } else if (err.message.includes('402') || err.message.includes('credits')) {
          console.log(chalk.yellow('💡 Подсказка: Для этой коммерческой модели нужен баланс на openrouter.ai/credits или выберите бесплатную модель через /model'));
        } else if (err.message.includes('free-models-per-day') || err.message.includes('429')) {
          console.log(chalk.yellow('💡 Подсказка: Дневной лимит бесплатных запросов OpenRouter исчерпан (50/день). Создайте новый ключ на openrouter.ai, дождитесь сброса или пополните баланс на $1.'));
        } else if (err.message.includes('404') || err.message.includes('No endpoints found') || err.message.includes('unavailable')) {
          console.log(chalk.yellow(`💡 Подсказка: Модель "${session.model}" временно недоступна. Выберите другую через /model`));
        }
        console.log();
      }
    } finally {
      process.removeListener('SIGINT', onSigintStreaming);
    }

  }
}
