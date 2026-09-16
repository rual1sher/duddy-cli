import { select, input, password } from './prompts.js';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig, DEFAULT_SYSTEM_PROMPT } from './config.js';
import { printBanner } from './banner.js';
import { copyToClipboard, saveCodeToFile } from './clipboard.js';
import { MODEL_CATEGORIES, getAllCuratedModels, searchOpenRouterModels } from './models.js';
import { loginViaBrowser } from './auth.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Сменить AI модель (Gemini, GPT, Claude, Llama, Free...)' },
  { cmd: '/copy', desc: 'Скопировать последний код в буфер обмена (wl-copy)' },
  { cmd: '/save [файл]', desc: 'Сохранить код в файл (например: /save index.html)' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter (через браузер OAuth или ключ)' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/system', desc: 'Сменить роль / характер ассистента' },
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
  console.log(chalk.dim('\n💡 Подсказка: нажми Tab после ввода / для автодополнения команд.\n'));
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

export function handleUsageCommand(session) {
  const turns = session.messages.filter(m => m.role === 'user').length;
  console.log(chalk.cyan('\n📊 Статистика текущей сессии:'));
  console.log(`  Активная модель:  ${chalk.greenBright(session.model)}`);
  console.log(`  Сообщений в чате: ${chalk.bold(turns)}`);
  console.log(`  Размер истории:   ${chalk.bold(session.messages.length)} реплик`);
  console.log();
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

export function handleCopyCommand(session) {
  const codeToCopy = session.lastCode || (session.messages.length > 0 ? session.messages[session.messages.length - 1]?.content : '');
  if (!codeToCopy) {
    console.log(chalk.yellow('! Пока нет кода для копирования. Сначала сгенерируй код!\n'));
    return;
  }

  const ok = copyToClipboard(codeToCopy);
  if (ok) {
    console.log(chalk.green('✓ Код успешно скопирован в буфер обмена! Вставляй через Ctrl+V.\n'));
  } else {
    console.log(chalk.red('✗ Не удалось скопировать (убедись, что установлен wl-copy или xclip).\n'));
  }
}

export async function handleSaveCommand(args, session) {
  const codeToSave = session.lastCode || (session.messages.length > 0 ? session.messages[session.messages.length - 1]?.content : '');
  if (!codeToSave) {
    console.log(chalk.yellow('! Пока нет кода для сохранения. Сначала сгенерируй код!\n'));
    return;
  }

  let fileName = args ? args.trim() : '';
  if (!fileName) {
    fileName = await input({
      message: `Введите имя файла для сохранения (например, index.html) ${chalk.dim('(Esc — отмена)')}:`
    });
    if (fileName === null) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }
  }

  if (!fileName.trim()) {
    console.log(chalk.yellow('! Сохранение отменено, имя файла не указано.\n'));
    return;
  }

  const ok = saveCodeToFile(fileName.trim(), codeToSave);
  if (ok) {
    console.log(chalk.green(`✓ Код успешно сохранен в файл: ${chalk.bold(fileName.trim())}\n`));
  } else {
    console.log(chalk.red(`✗ Не удалось сохранить файл: ${fileName.trim()}\n`));
  }
}
