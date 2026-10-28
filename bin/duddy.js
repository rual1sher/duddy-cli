#!/usr/bin/env node

import fs from 'node:fs';
import { loadConfig, getActiveApiKey, DEFAULT_SYSTEM_PROMPT } from '../src/config.js';
import { getProvider } from '../src/providers.js';
import { startTui } from '../src/ui/index.js';
import { runAgentTurn } from '../src/agent.js';
import { handleModelError, errorText } from '../src/errors.js';
import { createPlainRenderer } from '../src/plainRenderer.js';
import { formatDuration } from '../src/formatter.js';
import chalk from 'chalk';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const config = loadConfig();
  const provider = config.provider || 'openrouter';
  const apiKey = getActiveApiKey(config);

  const rawArgs = process.argv.slice(2);

  // Handle flags
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(`
${chalk.bold.cyan('Duddy')} - Terminal AI Assistant for Linux & DevOps

${chalk.bold('Usage:')}
  ${chalk.green('duddy')}                       Start interactive chat session (like agy)
  ${chalk.green('duddy "your question"')}       Ask a quick one-off question
  ${chalk.green('cat error.log | duddy "explain"')} Analyze piped input

${chalk.bold('Options:')}
  ${chalk.yellow('-y, --yes')}   Automatically confirm all tool actions without prompt
  ${chalk.yellow('-h, --help')}  Show help
  ${chalk.yellow('-v, --version')} Show version

${chalk.bold('Interactive Commands:')}
  ${chalk.yellow('/model')}   Список моделей ваших провайдеров с поиском
  ${chalk.yellow('/effort')}  Set reasoning level (auto, low, medium, high)
  ${chalk.yellow('/login')}   Login: OpenRouter or Google AI Studio
  ${chalk.yellow('/clear')}   Clear conversation context
  ${chalk.yellow('/usage')}   Show session stats
  ${chalk.yellow('/exit')}    Quit session
`);
    process.exit(0);
  }

  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    console.log(`duddy v${pkg.version}`);
    process.exit(0);
  }

  let autoApprove = false;
  const args = [];
  for (const arg of rawArgs) {
    if (arg === '--yes' || arg === '-y') {
      autoApprove = true;
    } else {
      args.push(arg);
    }
  }

  const session = {
    provider,
    apiKey,
    model: config.model || config.models?.[provider] || (provider === 'google' ? 'gemini-3.5-flash' : 'openrouter/free'),
    reasoningEffort: config.reasoningEffort || 'auto',
    temperature: config.temperature ?? 0.4,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    messages: [],
    autoApprove
  };

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
      const p = getProvider(session.provider);
      const envHint = p.envVars.join(' или ');
      console.error(chalk.red(`Error: ${p.title} API key not configured. Run \`duddy\` interactively or set ${envHint}.`));
      process.exit(1);
    }

    const interactive = process.stdin.isTTY === true;
    const renderer = createPlainRenderer(session, { interactive });
    const toolCtx = {
      autoApprove: !!session.autoApprove,
      canPrompt: interactive,
      ...renderer.toolCtxExtras
    };

    const startTime = Date.now();
    const messagesToSend = [
      { role: 'system', content: session.systemPrompt },
      { role: 'user', content: combinedContent }
    ];

    try {
      const { lastUsage, elapsedMs } = await runAgentTurn({
        session,
        messages: messagesToSend,
        toolCtx,
        events: renderer.events
      });

      const durationStr = formatDuration(elapsedMs ?? (Date.now() - startTime));
      const tokFormatted = (lastUsage?.total_tokens ?? 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
      const tokenInfo = lastUsage?.total_tokens ? ` · ${tokFormatted} tok` : '';
      console.log(chalk.hex('#334155')('╰─ ') + chalk.hex('#10b981')('✔ Готово') + chalk.hex('#64748b')(` · ${durationStr}${tokenInfo}\n`));
    } catch (err) {
      console.error(chalk.red(`\nError: ${errorText(err)}`));
      const hint = handleModelError(err, session);
      if (hint) console.error(chalk.yellow(`↳ ${hint}`));
      process.exit(1);
    } finally {
      renderer.finish();
    }
    return;
  }

  // If stdin is not TTY and no arguments or piped data provided
  if (!process.stdin.isTTY) {
    console.error(chalk.yellow('Интерактивный режим недоступен без TTY. Для разового запроса используйте: duddy "вопрос"'));
    process.exit(1);
  }

  // Default: Interactive TUI mode
  await startTui(session);
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
