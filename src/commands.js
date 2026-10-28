import { select, input, password } from './prompts.js';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig, DEFAULT_SYSTEM_PROMPT } from './config.js';
import { printBanner } from './banner.js';
import { MODEL_CATEGORIES, getAllCuratedModels, searchOpenRouterModels } from './models.js';
import { loginViaBrowser } from './auth.js';
import { fetchKeyInfo, getModelContextLength } from './api.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Сменить AI модель (Gemini, GPT, Claude, Llama, Free...)' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter (через браузер OAuth или ключ)' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/usage', desc: 'Показать статистику текущей сессии' },
  { cmd: '/help', desc: 'Показать список всех команд' },
  { cmd: '/exit', desc: 'Выйти из Duddy (или /quit)' }
];

/**
 * Handle /model command with interactive category browser, search, and manual input
 */
export async function handleModelCommand(args, session) {
  const trimmedArgs = (args || '').trim();

  // If user provided a direct model name or keyword
  if (trimmedArgs) {
    const lower = trimmedArgs.toLowerCase();

    // Check if user specified a provider keyword
    let targetCategory = null;
    if (lower === 'gemini' || lower === 'google') targetCategory = 'google';
    else if (lower === 'gpt' || lower === 'openai') targetCategory = 'openai';
    else if (lower === 'claude' || lower === 'anthropic') targetCategory = 'anthropic';
    else if (lower === 'llama' || lower === 'meta') targetCategory = 'meta';
    else if (lower === 'free') targetCategory = 'free';
    else if (lower === 'deepseek') targetCategory = 'deepseek';

    if (targetCategory) {
      await showCategoryModels(targetCategory, session);
      return;
    }

    if (lower.startsWith('search ')) {
      await searchAndSelectModel(trimmedArgs.slice(7).trim(), session);
      return;
    }

    // Direct model ID provided (e.g. google/gemini-3.8-flash)
    session.model = trimmedArgs;
    saveConfig({ model: trimmedArgs });
    console.log(chalk.green(`✓ Модель установлена: ${chalk.bold(trimmedArgs)}\n`));
    return;
  }

  // Interactive top-level menu
  const categoryChoices = [
    {
      name: `${MODEL_CATEGORIES.free.title} — ${chalk.dim('openrouter/free, gemma, nemotron')}`,
      value: 'cat_free',
      description: MODEL_CATEGORIES.free.description
    },
    {
      name: `${MODEL_CATEGORIES.google.title} — ${chalk.dim('Gemini 3.8 Flash, 3.7 Flash, Lite')}`,
      value: 'cat_google',
      description: MODEL_CATEGORIES.google.description
    },
    {
      name: `${MODEL_CATEGORIES.openai.title} — ${chalk.dim('GPT-4.1, GPT-4.1 Mini, GPT-4o, o3-mini')}`,
      value: 'cat_openai',
      description: MODEL_CATEGORIES.openai.description
    },
    {
      name: `${MODEL_CATEGORIES.anthropic.title} — ${chalk.dim('Claude Sonnet 4.6, Haiku 4.5, Opus')}`,
      value: 'cat_anthropic',
      description: MODEL_CATEGORIES.anthropic.description
    },
    {
      name: `${MODEL_CATEGORIES.meta.title} — ${chalk.dim('Llama 3.3 70B, Llama 4 Scout, 3.1 8B')}`,
      value: 'cat_meta',
      description: MODEL_CATEGORIES.meta.description
    },
    {
      name: `${MODEL_CATEGORIES.deepseek.title} — ${chalk.dim('DeepSeek V3, DeepSeek R1')}`,
      value: 'cat_deepseek',
      description: MODEL_CATEGORIES.deepseek.description
    },
    {
      name: `📋 ${chalk.bold('Все популярные модели единым списком...')}`,
      value: '__all__',
      description: 'Показать все топовые модели без разделения по категориям'
    },
    {
      name: `🔍 ${chalk.cyan('Поиск по каталогу OpenRouter (400+ моделей)...')}`,
      value: '__search__',
      description: 'Найти модель по названию или провайдеру онлайн'
    },
    {
      name: `✏️  ${chalk.dim('Ввести ID модели вручную...')}`,
      value: '__custom__',
      description: 'Например: mistralai/mistral-large или qwen/qwen-2.5-72b'
    }
  ];

  const action = await select({
    message: 'Выберите категорию или действие:',
    choices: categoryChoices
  });

  if (!action) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (action.startsWith('cat_')) {
    const catKey = action.replace('cat_', '');
    await showCategoryModels(catKey, session);
  } else if (action === '__all__') {
    await showAllCurated(session);
  } else if (action === '__search__') {
    const query = await input({ message: `Введите ключевое слово для поиска (например, gemini, claude, qwen) ${chalk.dim('(Esc — отмена)')}:` });
    if (query === null) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }
    if (query.trim()) {
      await searchAndSelectModel(query.trim(), session);
    }
  } else if (action === '__custom__') {
    const customName = await input({ message: `Введите точный ID модели из OpenRouter ${chalk.dim('(Esc — отмена)')}:` });
    if (customName === null) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }
    if (customName.trim()) {
      session.model = customName.trim();
      saveConfig({ model: session.model });
      console.log(chalk.green(`✓ Модель установлена: ${chalk.bold(session.model)}\n`));
    }
  }
}

async function showCategoryModels(catKey, session) {
  const cat = MODEL_CATEGORIES[catKey];
  if (!cat) return;

  const choices = cat.models.map(m => ({
    name: `${m.badge} ${chalk.bold(m.name)} ${chalk.dim(`(${m.id})`)}`,
    value: m.id,
    description: m.desc
  }));

  choices.push({
    name: chalk.dim('← Назад в меню выбора'),
    value: '__back__',
    description: 'Вернуться к списку категорий'
  });

  const chosen = await select({
    message: `${cat.title}:`,
    choices
  });

  if (!chosen) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (chosen === '__back__') {
    await handleModelCommand('', session);
    return;
  }

  session.model = chosen;
  saveConfig({ model: chosen });
  console.log(chalk.green(`✓ Модель переключена на: ${chalk.bold(chosen)}`));

  if (cat.requiresCredits) {
    console.log(chalk.dim('💡 Подсказка: для коммерческих моделей (OpenAI, Anthropic, Gemini, Meta) на OpenRouter необходим баланс (от $1 на openrouter.ai/credits) либо привязанный BYOK-ключ.\n'));
  } else {
    console.log();
  }
}

async function showAllCurated(session) {
  const all = getAllCuratedModels();
  const choices = all.map(m => ({
    name: `${m.badge} ${chalk.bold(m.name)} ${chalk.dim(`(${m.id})`)}`,
    value: m.id,
    description: m.desc
  }));

  choices.push({
    name: chalk.dim('← Назад'),
    value: '__back__'
  });

  const chosen = await select({
    message: 'Выберите модель:',
    choices
  });

  if (!chosen) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (chosen === '__back__') {
    await handleModelCommand('', session);
    return;
  }

  session.model = chosen;
  saveConfig({ model: chosen });
  console.log(chalk.green(`✓ Модель переключена на: ${chalk.bold(chosen)}\n`));
}

async function searchAndSelectModel(query, session) {
  const spinner = ora({ text: chalk.dim(`Поиск "${query}" в каталоге OpenRouter...`), color: 'cyan' }).start();
  const results = await searchOpenRouterModels(query);
  spinner.stop();

  if (results.length === 0) {
    console.log(chalk.yellow(`По запросу "${query}" ничего не найдено в каталоге OpenRouter.\n`));
    return;
  }

  const choices = results.map(m => ({
    name: `${chalk.bold(m.name || m.id)} ${chalk.dim(`(${m.id})`)}`,
    value: m.id,
    description: m.description ? m.description.slice(0, 100) : m.id
  }));

  choices.push({
    name: chalk.dim('← Назад'),
    value: '__back__'
  });

  const chosen = await select({
    message: `Результаты поиска (${results.length}):`,
    choices
  });

  if (!chosen) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (chosen === '__back__') {
    await handleModelCommand('', session);
    return;
  }

  session.model = chosen;
  saveConfig({ model: chosen });
  console.log(chalk.green(`✓ Модель переключена на: ${chalk.bold(chosen)}\n`));
}

export async function handleLoginCommand(session, args = '') {
  const trimmedArgs = (args || '').trim();

  if (trimmedArgs.toLowerCase() === 'browser' || trimmedArgs.toLowerCase() === 'web') {
    const key = await loginViaBrowser();
    if (key) {
      saveConfig({ apiKey: key });
      session.apiKey = key;
      console.log(chalk.green('✓ Ключ успешно получен и сохранен в ~/.config/duddy/config.json\n'));
    }
    return;
  }

  if (trimmedArgs.startsWith('sk-or-')) {
    saveConfig({ apiKey: trimmedArgs });
    session.apiKey = trimmedArgs;
    console.log(chalk.green('✓ Ключ успешно сохранен в ~/.config/duddy/config.json\n'));
    return;
  }

  const method = await select({
    message: 'Выберите способ авторизации в OpenRouter:',
    choices: [
      {
        name: `🌐 ${chalk.bold.hex('#38bdf8')('Войти через браузер')} ${chalk.green('(как в agy / OAuth PKCE)')}`,
        value: 'browser',
        description: 'Откроет страницу OpenRouter в браузере и автоматически свяжет аккаунт'
      },
      {
        name: `✏️  ${chalk.dim('Вставить API ключ вручную (sk-or-...)')}`,
        value: 'manual',
        description: 'Ввести или скопировать существующий ключ из openrouter.ai/keys'
      }
    ]
  });

  if (!method) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (method === 'browser') {
    const key = await loginViaBrowser();
    if (key) {
      saveConfig({ apiKey: key });
      session.apiKey = key;
      console.log(chalk.green('✓ Успешный вход! Ключ OpenRouter сохранен в ~/.config/duddy/config.json\n'));
    }
    return;
  }

  console.log(chalk.dim('Получить ключ можно на: https://openrouter.ai/keys'));
  const key = await password({
    message: `Введите API ключ OpenRouter (sk-or-...) ${chalk.dim('(Esc — отмена)')}:`,
    mask: '*'
  });

  if (key === null) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (key.trim()) {
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
  console.log(chalk.dim('\n💡 Подсказка: нажми Tab после ввода / для автодополнения команд.'));
  console.log(chalk.bold.hex('#38bdf8')('\n🛠️  Файловые операции (AI Agent):'));
  console.log(chalk.dim('  Duddy умеет создавать папки, файлы, читать и точечно изменять код в файлах.'));
  console.log(chalk.dim('  Просто напишите в чат: "создай папку src/components", "прочитай package.json" и т.д.\n'));
}

export function handleClearCommand(session) {
  console.clear();
  session.messages = [];
  printBanner({
    model: session.model,
    hasKey: !!session.apiKey,
    temperature: session.temperature ?? 0.4
  });
  console.log(chalk.green('✓ Экран и контекст диалога полностью очищены. Начат новый диалог.\n'));
}

function makeProgressBar(percent, width = 16) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;

  let color = chalk.hex('#10b981'); // green
  if (p >= 80) color = chalk.hex('#ef4444'); // red
  else if (p >= 50) color = chalk.hex('#f59e0b'); // yellow

  return color('█'.repeat(filled)) + chalk.hex('#334155')('░'.repeat(empty)) + ' ' + color((p + '%').padStart(4));
}

function getTimeUntilMidnightUTC() {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const diffMs = nextUTC.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}ч ${mins}м`;
}

export async function handleUsageCommand(session) {
  if (!session.contextLength) {
    try {
      session.contextLength = await getModelContextLength(session.model);
    } catch {}
  }

  const turns = session.messages.filter(m => m.role === 'user').length;
  const totalTokens = session.totalTokens ?? 0;
  const lastTokens = session.lastUsage?.total_tokens ?? 0;
  const maxContext = session.contextLength || 128000;
  const remainingTokens = Math.max(0, maxContext - lastTokens);
  const contextUsedPct = Math.min(100, Math.max(0, Math.round((lastTokens / maxContext) * 100)));

  const historyCount = session.messages.length;
  const maxHistory = 20;
  const histPct = Math.round((historyCount / maxHistory) * 100);

  console.log(chalk.bold.cyan('\n📊 Мониторинг лимитов и токенов (OpenRouter):'));
  console.log();

  // 1. Окно контекста активной модели (Context Window)
  console.log(chalk.bold(`  🧠 Окно контекста активной модели (${chalk.hex('#38bdf8')(session.model)}):`));
  console.log('  ' + makeProgressBar(contextUsedPct) + chalk.dim('  ·  ') +
    chalk.hex('#94a3b8')(`${lastTokens.toLocaleString('ru-RU')} из ${maxContext.toLocaleString('ru-RU')} tok`) +
    chalk.hex('#10b981')(` (${remainingTokens.toLocaleString('ru-RU')} свободно)`));
  console.log(chalk.dim(`  ↳ Занято в текущем контексте: ${chalk.bold.hex('#f59e0b')(lastTokens.toLocaleString('ru-RU'))} токенов (${contextUsedPct}%)`));
  console.log(chalk.dim(`  ↳ Осталось свободно в окне модели: ${chalk.bold.hex('#10b981')(remainingTokens.toLocaleString('ru-RU'))} токенов (${100 - contextUsedPct}%)\n`));

  // 2. Дневной лимит бесплатных запросов (если есть)
  if (session.keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = session.keyInfo.free_model_daily_requests;
    const freePct = Math.round((used / limit) * 100);
    const timeUntilReset = getTimeUntilMidnightUTC();
    console.log(chalk.bold('  🌟 Дневной лимит бесплатных запросов (Daily Free):'));
    console.log('  ' + makeProgressBar(freePct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${used} из ${limit} запросов`) + chalk.hex('#10b981')(` (${remaining} осталось)`));
    console.log(chalk.dim(`  ↳ Сбрасывается каждые сутки в 00:00 UTC (до сброса осталось: ${chalk.hex('#38bdf8')(timeUntilReset)})\n`));
  }

  // 3. Периодический расход аккаунта
  const dailySpend = Number(session.keyInfo?.usage_daily || 0).toFixed(2);
  const weeklySpend = Number(session.keyInfo?.usage_weekly || 0).toFixed(2);
  const monthlySpend = Number(session.keyInfo?.usage_monthly || 0).toFixed(2);

  if (session.keyInfo?.limit) {
    const totalSpend = Number(session.keyInfo.usage || 0);
    const keyLimit = Number(session.keyInfo.limit);
    const limitPct = Math.round((totalSpend / keyLimit) * 100);
    console.log(chalk.bold('  💳 Баланс и лимиты ключа:'));
    console.log('  ' + makeProgressBar(limitPct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`$${totalSpend.toFixed(2)} из $${keyLimit.toFixed(2)} лимита`) + chalk.hex('#10b981')(` ($${Number(session.keyInfo.limit_remaining || 0).toFixed(2)} осталось)`));
    console.log(`  День: ${chalk.hex('#38bdf8')(`$${dailySpend}`)} · Неделя: ${chalk.hex('#38bdf8')(`$${weeklySpend}`)} · Месяц: ${chalk.hex('#38bdf8')(`$${monthlySpend}`)}`);
    console.log();
  }

  // 4. Буфер диалога и суммарный расход сессии
  console.log(chalk.bold('  📦 Буфер памяти диалога (Context History):'));
  console.log('  ' + makeProgressBar(histPct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${historyCount} из ${maxHistory} сообщений в памяти диалога`));
  console.log(chalk.dim(`  ↳ Запросов в текущем сеансе: ${chalk.bold(turns)}`));
  console.log(chalk.dim(`  ↳ Всего токенов обработано за сессию (счётчик): ${chalk.hex('#f59e0b')(`${totalTokens.toLocaleString('ru-RU')} tok`)}\n`));
}


export async function handleSystemCommand(session) {
  const choice = await select({
    message: 'Выберите роль / характер ассистента:',
    choices: [
      {
        name: '🚀 Лаконичный DevOps & Dev (По умолчанию) — суть, код и команды без воды, экономия токенов',
        value: DEFAULT_SYSTEM_PROMPT
      },
      {
        name: '⚡ Ультра-краткий помощник терминала — только bash-команда и флаги',
        value: 'You are Duddy, an ultra-concise terminal command generator. Output strictly the executable command with minimal comments. Zero conversational pleasantries. Zero explanations unless critical for system safety.'
      },
      {
        name: '📚 Старший Ментор и Архитектор — развернутые архитектурные разборы и лучшие практики',
        value: 'You are Duddy, a Senior Full-Stack and DevOps mentor. Provide in-depth explanations, architectural considerations, and clean, modern code examples. Avoid empty pleasantries.'
      },
      {
        name: '✏️ Свой системный промпт...',
        value: '__custom__'
      }
    ]
  });

  if (!choice) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (choice === '__custom__') {
    const customPrompt = await input({
      message: `Введите свой системный промпт ${chalk.dim('(Esc — отмена)')}:`
    });
    if (customPrompt === null) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }
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
