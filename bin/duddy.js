#!/usr/bin/env node

import { loadConfig, getApiKey } from '../src/config.js';
import { startRepl } from '../src/repl.js';
import { streamChatCompletion } from '../src/api.js';
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
  ${chalk.yellow('/model')}   Switch AI models (DeepSeek R1, Llama 3.3, Qwen Coder, etc.)
  ${chalk.yellow('/login')}   Configure OpenRouter API Key
  ${chalk.yellow('/clear')}   Clear conversation context
  ${chalk.yellow('/system')}  Change AI personality / prompt
  ${chalk.yellow('/usage')}   Show conversation turn counts
  ${chalk.yellow('/exit')}    Quit session
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('duddy v1.0.0');
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

    const spinner = ora({
      text: chalk.dim(`Thinking (${session.model})...`),
      color: 'cyan'
    }).start();

    let startedStreaming = false;

    try {
      await streamChatCompletion({
        apiKey: session.apiKey,
        model: session.model,
        messages: [
          { role: 'system', content: session.systemPrompt },
          { role: 'user', content: combinedContent }
        ],
        onChunk: (chunk) => {
          if (!startedStreaming) {
            spinner.stop();
            startedStreaming = true;
          }
          process.stdout.write(chunk);
        }
      });
      console.log();
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
