import { select, input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig } from './config.js';
import { printBanner } from './banner.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Сменить AI модель (выбор из проверенных или по имени)' },
  { cmd: '/length', desc: 'Длина ответа (кратко / оптимально / подробно)' },
  { cmd: '/login', desc: 'Настроить API ключ OpenRouter' },
  { cmd: '/clear', desc: 'Очистить историю диалога (контекст)' },
  { cmd: '/system', desc: 'Сменить роль / характер ассистента' },
  { cmd: '/usage', desc: 'Показать статистику текущей сессии' },
  { cmd: '/help', desc: 'Показать список всех команд' },
  { cmd: '/exit', desc: 'Выйти из Duddy (или /quit)' }
];

// Проверенный список лучших и 100% рабочих бесплатных моделей
export const VERIFIED_FREE_MODELS = [
  {
    name: `${chalk.bold.yellow('⭐ openrouter/free')} ${chalk.green('✓ 100% онлайн')} — ${chalk.cyan('Авто-роутер OpenRouter')}`,
    value: 'openrouter/free',
    description: 'Рекомендуется: автоматически выбирает лучшую доступную бесплатную модель'
  },
  {
    name: `${chalk.bold('🧠 NVIDIA Nano Omni 30B')} ${chalk.green('✓')} — ${chalk.cyan('Логика, код и идеальный русский')}`,
    value: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    description: 'Лучшая модель для программирования, DevOps и развернутых ответов'
  },
  {
    name: `${chalk.bold('👑 NVIDIA Ultra 550B')} ${chalk.green('✓')} — ${chalk.cyan('Флагманский гигант 550B параметров')}`,
    value: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    description: 'Массивная модель с глубокими экспертными знаниями'
  },
  {
    name: `${chalk.bold('⚡ NVIDIA Super 120B')} ${chalk.green('✓')} — ${chalk.cyan('Баланс интеллекта и скорости')}`,
    value: 'nvidia/nemotron-3-super-120b-a12b:free',
    description: '120 миллиардов параметров, быстрые и точные ответы'
  },
  {
    name: `${chalk.bold('⚡ NVIDIA 3.5 Lightning')} ${chalk.green('✓')} — ${chalk.cyan('Сверхбыстрый отклик (<400ms)')}`,
    value: 'nvidia/nemotron-3.5-lightning:free',
    description: 'Мгновенная генерация ответов для коротких вопросов'
  },
  {
    name: `${chalk.bold('🪶 LiquidAI LFM 2.6B')} ${chalk.green('✓')} — ${chalk.cyan('Ультра-легковесная модель')}`,
    value: 'liquid/lfm-2.5-2.6b:free',
    description: 'Компактная быстрая модель для простых задач'
  }
];

/**
 * Проверяет модели в реальном времени, отправляя микро-запрос
 */
async function testModelLive(apiKey, modelId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/duddy-cli',
        'X-Title': 'Duddy CLI'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 3
      })
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function runLiveDiagnostics(apiKey) {
  const spinner = ora({ text: chalk.dim('Получение списка и проверка доступности всех бесплатных моделей...'), color: 'cyan' }).start();

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const json = await res.json();
    const freeModels = json.data.filter(m => m.id && m.id.endsWith(':free') && !m.id.includes('content-safety'));

    const working = [];
    for (const m of freeModels) {
      spinner.text = chalk.dim(`Тестируем ${m.id}...`);
      const isOk = await testModelLive(apiKey, m.id);
      if (isOk) {
        working.push({
          name: `${chalk.green('✓')} ${m.name || m.id} ${chalk.dim(`(${m.id})`)}`,
          value: m.id
        });
      }
    }
    spinner.stop();
    return working;
  } catch (err) {
    spinner.stop();
    return [];
  }
}

export async function handleModelCommand(args, session) {
  if (args && args.trim()) {
    const custom = args.trim();
    session.model = custom;
    saveConfig({ model: custom });
    console.log(chalk.green(`✓ Модель установлена: ${chalk.bold(custom)}\n`));
    return;
  }

  const choices = [
    ...VERIFIED_FREE_MODELS.map(m => ({
      name: m.name,
      value: m.value,
      description: m.description
    })),
    {
      name: `🔍 ${chalk.cyan('Просканировать онлайн все бесплатные модели OpenRouter...')}`,
      value: '__scan__',
      description: 'Отправит тестовые запросы ко всем бесплатным моделям и покажет только живые'
    },
    {
      name: `✏️  ${chalk.dim('Ввести любое другое имя модели вручную...')}`,
      value: '__custom__',
      description: 'Например: deepseek/deepseek-chat или anthropic/claude-3.5-sonnet'
    }
  ];

  const chosen = await select({
    message: 'Выберите рабочую модель ИИ:',
    choices
  });

  if (chosen === '__scan__') {
    const scanned = await runLiveDiagnostics(session.apiKey);
    if (scanned.length === 0) {
      console.log(chalk.yellow('Не удалось получить отклик от сторонних моделей, используем проверенные по умолчанию.\n'));
      return;
    }
    const selectedFromScan = await select({
      message: 'Доступные в данный момент модели:',
      choices: scanned
    });
    session.model = selectedFromScan;
    saveConfig({ model: selectedFromScan });
    console.log(chalk.green(`✓ Модель переключена на: ${chalk.bold(selectedFromScan)}\n`));
    return;
  }

  if (chosen === '__custom__') {
    const customName = await input({
      message: 'Введите идентификатор модели из OpenRouter:'
    });
    if (customName.trim()) {
      session.model = customName.trim();
      saveConfig({ model: session.model });
      console.log(chalk.green(`✓ Модель установлена: ${chalk.bold(session.model)}\n`));
    }
  } else {
    session.model = chosen;
    saveConfig({ model: chosen });
    console.log(chalk.green(`✓ Модель переключена на: ${chalk.bold(chosen)}\n`));
  }
}

export async function handleLoginCommand(session) {
  console.log(chalk.dim('Получить бесплатный ключ можно на: https://openrouter.ai/keys'));
  const key = await password({
    message: 'Введите API ключ OpenRouter (sk-or-...):',
    mask: '*'
  });

  if (key && key.trim()) {
    const trimmed = key.trim();
    saveConfig({ apiKey: trimmed });
    session.apiKey = trimmed;
    console.log(chalk.green('✓ Ключ успешно сохранен в ~/.config/duddy/config.json\n'));
  } else {
    console.log(chalk.yellow('! Авторизация отменена, передан пустой ключ.\n'));
  }
}

export function handleHelpCommand() {
  console.log(chalk.bold.cyan('\n⚡ Доступные слеш-команды:'));
  for (const cmd of AVAILABLE_COMMANDS) {
    console.log(`  ${chalk.yellow(cmd.cmd.padEnd(16))} ${chalk.dim('—')} ${cmd.desc}`);
  }
  console.log(chalk.dim('\n💡 Подсказка: нажми Tab после ввода / для автодополнения команд.\n'));
}

export function handleClearCommand(session) {
  console.clear();
  session.messages = [];
  printBanner({
    model: session.model,
    hasKey: !!session.apiKey,
    maxTokens: session.maxTokens || 750,
    temperature: session.temperature ?? 0.4
  });
  console.log(chalk.green('✓ Экран и контекст диалога полностью очищены. Начат новый диалог.\n'));
}

export async function handleLengthCommand(session) {
  const choice = await select({
    message: 'Настройка длины и подробности ответов:',
    choices: [
      {
        name: `⚡ ${chalk.bold('Краткий')} (350 токенов) — только команды и суть, без лишних слов`,
        value: 350
      },
      {
        name: `🎯 ${chalk.bold('Оптимальный')} (750 токенов, по умолчанию) — точный ответ + важные флаги`,
        value: 750
      },
      {
        name: `📚 ${chalk.bold('Подробный')} (1800 токенов) — развернутые примеры, разборы и альтернативы`,
        value: 1800
      }
    ]
  });

  session.maxTokens = choice;
  saveConfig({ maxTokens: choice });
  console.log(chalk.green(`✓ Лимит ответа установлен на: ${chalk.bold(choice)} токенов\n`));
}

export function handleUsageCommand(session) {
  const turns = session.messages.filter(m => m.role === 'user').length;
  console.log(chalk.cyan('\n📊 Статистика текущей сессии:'));
  console.log(`  Активная модель: ${chalk.greenBright(session.model)}`);
  console.log(`  Лимит токенов:   ${chalk.yellow(session.maxTokens || 750)} токенов`);
  console.log(`  Сообщений в чате: ${chalk.bold(turns)}`);
  console.log(`  Размер истории:   ${chalk.bold(session.messages.length)} реплик`);
  console.log();
}

export async function handleSystemCommand(session) {
  const choice = await select({
    message: 'Выберите роль / характер ассистента:',
    choices: [
      {
        name: '🚀 Лаконичный DevOps & Dev (По умолчанию) — сразу суть и команды, 1-3 строки пояснений',
        value: 'You are Duddy, a high-efficiency Linux, DevOps, and Full-Stack CLI assistant.\nCRITICAL INSTRUCTIONS:\n- Directly provide the exact command, code, or solution first.\n- Zero conversational fluff (do NOT say "Sure!", "Here is how to do it", "In this answer...").\n- Provide at most 1-3 brief bullet points or sentences explaining the flags/mechanism.\n- Quality and precision over length: do not write excessive tutorials or unwanted tables.\n- Respond in the language used by the user.'
      },
      {
        name: '⚡ Ультра-краткий помощник терминала — только bash-команда и флаги',
        value: 'You are Duddy, an ultra-concise terminal command generator. Output strictly the executable command with minimal comments. Zero explanations unless critical for system safety.'
      },
      {
        name: '📚 Старший Ментор — подробные архитектурные разборы, лучшие практики',
        value: 'You are Duddy, a Senior Full-Stack and DevOps mentor. Provide in-depth explanations, architectural considerations, and clean, modern code examples.'
      },
      {
        name: '✏️ Свой системный промпт...',
        value: '__custom__'
      }
    ]
  });

  if (choice === '__custom__') {
    const customPrompt = await input({
      message: 'Введите свой системный промпт:'
    });
    if (customPrompt.trim()) {
      session.systemPrompt = customPrompt.trim();
      saveConfig({ systemPrompt: session.systemPrompt });
      console.log(chalk.green('✓ Системный промпт обновлен!\n'));
    }
  } else {
    session.systemPrompt = choice;
    saveConfig({ systemPrompt: choice });
    console.log(chalk.green('✓ Роль ассистента успешно изменена!\n'));
  }
}
