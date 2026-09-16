import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner } from './banner.js';
import { streamChatCompletion } from './api.js';
import { AnimatedTerminalRenderer } from './formatter.js';
import { extractCodeBlocks } from './clipboard.js';
import {
  AVAILABLE_COMMANDS,
  handleHelpCommand,
  handleModelCommand,
  handleCopyCommand,
  handleSaveCommand,
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

function askLine(history) {
  return new Promise((resolve) => {
    process.stdin.resume();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      history
    });

    rl.question(chalk.bold.hex('#38bdf8')('> '), (answer) => {
      rl.close();
      resolve(answer);
    });

    rl.on('SIGINT', () => {
      rl.close();
      console.log(chalk.dim('\n\nBye! 👋'));
      process.exit(0);
    });
  });
}

export async function startRepl(session) {
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
      rawInput = await askLine(inputHistory);
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
          break;
        case 'copy':
        case 'cp':
          handleCopyCommand(session);
          break;
        case 'save':
          await handleSaveCommand(args, session);
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
          handleUsageCommand(session);
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
    const spinner = ora({
      text: chalk.bold.hex('#38bdf8')('Duddy думает... ') + chalk.hex('#64748b')(`(${session.model})`),
      color: 'cyan',
      spinner: 'dots12'
    }).start();

    const renderer = new AnimatedTerminalRenderer();
    let startedStreaming = false;
    let assistantText = '';

    try {
      assistantText = await streamChatCompletion({
        apiKey: session.apiKey,
        model: session.model,
        messages: messagesToSend,
        temperature: session.temperature ?? 0.4,
        onChunk: (chunk) => {
          if (!startedStreaming) {
            spinner.stop();
            process.stdout.write(chalk.hex('#334155')('\n╭─ ') + chalk.bold.hex('#38bdf8')('✦ Duddy') + chalk.hex('#475569')(` [${session.model}] `) + chalk.hex('#334155')('─'.repeat(26)) + '\n');
            startedStreaming = true;
          }
          renderer.push(chunk);
        }
      });

      await renderer.flush();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Extract raw code blocks for instant copying / saving
      const codeBlocks = extractCodeBlocks(assistantText);
      if (codeBlocks.length > 0) {
        session.lastCode = codeBlocks.join('\n\n');
        console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${elapsed}s  `) + chalk.bold.hex('#38bdf8')('[Скопировать: /copy | Сохранить: /save]') + '\n');
      } else {
        session.lastCode = assistantText;
        console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${elapsed}s\n`));
      }

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
  }
}
