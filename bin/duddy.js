#!/usr/bin/env node

import { loadConfig, getApiKey } from '../src/config.js';
import { startRepl } from '../src/repl.js';
import { streamChatCompletion, getModelContextLength } from '../src/api.js';
import { AnimatedTerminalRenderer } from '../src/formatter.js';
import { AGENT_TOOLS, executeTool } from '../src/tools.js';
import chalk from 'chalk';
import ora from 'ora';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const config = loadConfig();
  const apiKey = getApiKey();

  const session = {
    apiKey,
    model: config.model || 'openrouter/free',
    temperature: config.temperature ?? 0.4,
    systemPrompt: config.systemPrompt,
    messages: []
  };

  const args = process.argv.slice(2);

  // Handle flags
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.bold.cyan('Duddy')} - Terminal AI Assistant for Linux & DevOps

${chalk.bold('Usage:')}
  ${chalk.green('duddy')}                       Start interactive chat session (like agy)
  ${chalk.green('duddy "your question"')}       Ask a quick one-off question
  ${chalk.green('cat error.log | duddy "explain"')} Analyze piped input

${chalk.bold('Interactive Commands:')}
  ${chalk.yellow('/model')}   Switch AI models (Gemini, GPT, Claude, Llama, Free...)
  ${chalk.yellow('/login')}   Configure OpenRouter API Key
  ${chalk.yellow('/clear')}   Clear conversation context
  ${chalk.yellow('/system')}  Change AI personality / prompt
  ${chalk.yellow('/usage')}   Show session stats
  ${chalk.yellow('/exit')}    Quit session
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('duddy v1.3.0');
    process.exit(0);
  }

  // Check if data is being piped via stdin (e.g. cat file.log | duddy "explain")
  let pipedData = '';
  if (!process.stdin.isTTY) {
    pipedData = await readStdin();
  }

  // One-shot mode if arguments or piped data exist
  if (args.length > 0 || pipedData.trim()) {
    const userPrompt = args.join(' ');
    const combinedContent = pipedData.trim()
      ? `${userPrompt ? userPrompt + '\n\n' : ''}Context / Input:\n\`\`\`\n${pipedData.trim()}\n\`\`\``
      : userPrompt;

    if (!session.apiKey) {
      console.error(chalk.red('Error: OpenRouter API key not configured. Run `duddy` interactively or set OPENROUTER_API_KEY.'));
      process.exit(1);
    }

    const startTime = Date.now();
    let spinner = ora({
      text: chalk.bold.hex('#38bdf8')('Duddy думает... ') + chalk.hex('#64748b')(`(${session.model})`),
      color: 'cyan',
      spinner: 'dots12'
    }).start();

    const messagesToSend = [
      { role: 'system', content: session.systemPrompt },
      { role: 'user', content: combinedContent }
    ];

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
          temperature: session.temperature,
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
        }

        if (startedStreaming) {
          await renderer.flush();
        }

        if (toolCalls && toolCalls.length > 0) {
          spinner.stop();

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

          spinner = ora({
            text: chalk.bold.hex('#38bdf8')('Duddy анализирует результат... ') + chalk.hex('#64748b')(`(${session.model})`),
            color: 'cyan',
            spinner: 'dots12'
          }).start();

          continue;
        }

        break;
      }

      spinner.stop();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokFormatted = (lastTurnUsage?.total_tokens ?? 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
      const tokenInfo = lastTurnUsage?.total_tokens ? ` · ${tokFormatted} tok` : '';
      console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${elapsed}s${tokenInfo}\n`));
    } catch (err) {
      spinner.stop();
      console.error(chalk.red(`\nError: ${err.message}`));
      process.exit(1);
    }
    return;
  }

  // Default: Interactive REPL mode
  await startRepl(session);
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
