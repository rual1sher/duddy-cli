import { select, input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig } from './config.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Switch AI model (interactive or /model [name])' },
  { cmd: '/login', desc: 'Configure OpenRouter API key' },
  { cmd: '/clear', desc: 'Clear conversation context' },
  { cmd: '/system', desc: 'Change AI personality / system prompt' },
  { cmd: '/usage', desc: 'Show current session statistics' },
  { cmd: '/help', desc: 'Show detailed help' },
  { cmd: '/exit', desc: 'Exit Duddy (or /quit)' }
];

const FALLBACK_FREE_MODELS = [
  { name: 'NVIDIA Nemotron 3.5 Lightning (Free) - Fast & capable', value: 'nvidia/nemotron-3.5-lightning:free' },
  { name: 'Google Gemma 4 31B (Free) - High intelligence open weights', value: 'google/gemma-4-31b-it:free' },
  { name: 'Cohere North Mini Code (Free) - Specialized for code', value: 'cohere/north-mini-code:free' },
  { name: 'LiquidAI LFM 2.5 2.6B (Free) - Ultra-lightweight & fast', value: 'liquid/lfm-2.5-2.6b:free' },
  { name: 'Z.ai GLM 5.2 (Free) - General reasoning & chat', value: 'z-ai/glm-5.2:free' }
];

async function fetchLiveFreeModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return FALLBACK_FREE_MODELS;
    const json = await res.json();
    const free = json.data
      .filter(m => m.id && m.id.endsWith(':free'))
      .map(m => ({
        name: `${m.name || m.id} (Free)`,
        value: m.id
      }));
    return free.length > 0 ? free : FALLBACK_FREE_MODELS;
  } catch (err) {
    clearTimeout(timeout);
    return FALLBACK_FREE_MODELS;
  }
}

export async function handleModelCommand(args, session) {
  if (args && args.trim()) {
    const custom = args.trim();
    session.model = custom;
    saveConfig({ model: custom });
    console.log(chalk.green(`✓ Model set to: ${chalk.bold(custom)}\n`));
    return;
  }

  const spinner = ora({ text: chalk.dim('Fetching active free models from OpenRouter...'), color: 'cyan' }).start();
  const freeModels = await fetchLiveFreeModels();
  spinner.stop();

  const choices = [
    ...freeModels.map(m => ({
      name: `${m.name} ${chalk.dim(`(${m.value})`)}`,
      value: m.value
    })),
    {
      name: '✏️  Enter custom model ID...',
      value: '__custom__'
    }
  ];

  const chosen = await select({
    message: 'Select an AI model:',
    choices
  });

  if (chosen === '__custom__') {
    const customName = await input({
      message: 'Enter OpenRouter model ID (e.g. nvidia/nemotron-3.5-lightning:free):'
    });
    if (customName.trim()) {
      session.model = customName.trim();
      saveConfig({ model: session.model });
      console.log(chalk.green(`✓ Model set to: ${chalk.bold(session.model)}\n`));
    }
  } else {
    session.model = chosen;
    saveConfig({ model: chosen });
    console.log(chalk.green(`✓ Model switched to: ${chalk.bold(chosen)}\n`));
  }
}

export async function handleLoginCommand(session) {
  console.log(chalk.dim('Get your free API key at: https://openrouter.ai/keys'));
  const key = await password({
    message: 'Enter your OpenRouter API key:',
    mask: '*'
  });

  if (key && key.trim()) {
    const trimmed = key.trim();
    saveConfig({ apiKey: trimmed });
    session.apiKey = trimmed;
    console.log(chalk.green('✓ API key successfully saved to ~/.config/duddy/config.json\n'));
  } else {
    console.log(chalk.yellow('! Login canceled, empty key provided.\n'));
  }
}

export function handleHelpCommand() {
  console.log(chalk.bold.cyan('\n⚡ Available Slash Commands:'));
  for (const cmd of AVAILABLE_COMMANDS) {
    console.log(`  ${chalk.yellow(cmd.cmd.padEnd(16))} ${chalk.dim('—')} ${cmd.desc}`);
  }
  console.log(chalk.dim('\n💡 Tip: You can press Tab after typing / to autocomplete commands.\n'));
}

export function handleClearCommand(session) {
  session.messages = [];
  console.log(chalk.dim('✓ Conversation history cleared. New context started.\n'));
}

export function handleUsageCommand(session) {
  const turns = session.messages.filter(m => m.role === 'user').length;
  console.log(chalk.cyan('\n📊 Session Statistics:'));
  console.log(`  Current Model: ${chalk.greenBright(session.model)}`);
  console.log(`  User Turns:    ${chalk.bold(turns)}`);
  console.log(`  History Size:  ${chalk.bold(session.messages.length)} messages`);
  console.log();
}

export async function handleSystemCommand(session) {
  const choice = await select({
    message: 'Choose system prompt preset:',
    choices: [
      {
        name: 'DevOps & Linux Expert (Default) - Practical commands and architectures',
        value: 'You are Duddy, an expert Linux, DevOps, and Full-stack engineering AI companion. Answer concisely, practically, with code or commands when appropriate. Respond in the language used by the user.'
      },
      {
        name: 'Senior Full-Stack Mentor - Deep explanations & modern clean code',
        value: 'You are Duddy, a Senior Full-Stack and DevOps mentor. Provide in-depth explanations, architectural considerations, and clean, modern code examples.'
      },
      {
        name: 'Concise Terminal Shell Helper - Strictly commands, flags & 1-line notes',
        value: 'You are Duddy, a quick terminal assistant. Provide strictly commands, flags, and 1-2 sentence explanations. Zero fluff.'
      },
      {
        name: 'Custom prompt...',
        value: '__custom__'
      }
    ]
  });

  if (choice === '__custom__') {
    const customPrompt = await input({
      message: 'Enter your custom system prompt:'
    });
    if (customPrompt.trim()) {
      session.systemPrompt = customPrompt.trim();
      saveConfig({ systemPrompt: session.systemPrompt });
      console.log(chalk.green('✓ Custom system prompt set!\n'));
    }
  } else {
    session.systemPrompt = choice;
    saveConfig({ systemPrompt: choice });
    console.log(chalk.green('✓ System prompt preset updated!\n'));
  }
}
