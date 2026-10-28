/**
 * @fileoverview Слеш-команды Duddy CLI (/model, /login, /clear, /usage, /help, /exit)
 */

import { select, input, password, Separator } from './prompts.js';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, saveConfig } from './config.js';
import { printBanner } from './banner.js';
import { CURATED_MODELS, searchOpenRouterModels } from './models.js';
import { loginViaBrowser, openBrowser } from './auth.js';
import { fetchKeyInfo, getModelContextLength, listGoogleModels } from './api.js';
import { getProvider, getProviderKey, detectProviderForModel } from './providers.js';
import { MAX_HISTORY_TURNS } from './agent.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/model', desc: 'Сменить AI модель (Gemini, GPT, Claude, Llama, Free...)' },
  { cmd: '/effort', desc: 'Уровень рассуждений модели: low / medium / high' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter или Google AI Studio (браузер / ключ)' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/usage', desc: 'Показать статистику текущей сессии' },
  { cmd: '/help', desc: 'Показать список всех команд' },
  { cmd: '/exit', desc: 'Выйти из Duddy (или /quit)' }
];

/**
 * Авторизация в Google AI Studio по API-ключу
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<boolean>} Успешность авторизации
 */
export async function loginGoogleAiStudio(session) {
  console.log(chalk.bold.hex('#38bdf8')('\n✦ Google AI Studio — подключение Gemini API'));
  console.log(chalk.dim('Сейчас откроется страница: https://aistudio.google.com/apikey'));
  console.log(chalk.dim('Создайте ключ кнопкой «Create API key», скопируйте его и вставьте ниже.\n'));

  openBrowser('https://aistudio.google.com/apikey');

  const key = await password({
    message: `Введите API ключ Google AI Studio ${chalk.dim('(Esc — отмена)')}:`,
    mask: '*'
  });

  if (key === null || key === false) {
    console.log(chalk.dim('(Отменено)\n'));
    return false;
  }

  const trimmed = key.trim();
  if (!trimmed) {
    console.log(chalk.yellow('! Авторизация отменена, передан пустой ключ.\n'));
    return false;
  }

  const spinner = ora({
    text: chalk.bold.hex('#38bdf8')('Проверка ключа Google AI Studio...'),
    color: 'cyan'
  }).start();

  let models;
  try {
    models = await listGoogleModels(trimmed);
    spinner.stop();
  } catch (err) {
    spinner.stop();
    console.error(chalk.red(`\n✖ ${err.message}\n`));
    return false;
  }

  saveConfig({ googleApiKey: trimmed });

  let targetModel = 'gemini-3.5-flash';
  if (!models.includes(targetModel)) {
    const flashModel = models.find(m => m.toLowerCase().includes('flash'));
    targetModel = flashModel || models[0] || 'gemini-3.5-flash';
  }

  session.provider = 'google';
  session.apiKey = trimmed;
  session.model = targetModel;
  saveConfig({ provider: 'google', model: targetModel });

  try {
    session.contextLength = await getModelContextLength(targetModel, 'google', trimmed);
  } catch {}

  console.log(chalk.green(`✓ Google AI Studio подключён. Модель: ${chalk.bold(targetModel)}\n`));
  return true;
}

/**
 * Авторизация в OpenRouter (через браузер OAuth или ввод ключа вручную)
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {'browser'|'manual'} [method] - Способ авторизации
 * @returns {Promise<boolean>} Успешность авторизации
 */
export async function loginOpenRouter(session, method) {
  let selectedMethod = method;

  if (!selectedMethod) {
    selectedMethod = await select({
      message: 'Выберите способ авторизации в OpenRouter:',
      choices: [
        {
          name: `🌐 ${chalk.bold.hex('#38bdf8')('Войти через браузер')} ${chalk.green('(OAuth PKCE)')}`,
          value: 'browser',
          description: 'Откроет страницу OpenRouter в браузере и автоматически свяжет аккаунт'
        },
        {
          name: `🔑 ${chalk.dim('Вставить API ключ вручную (sk-or-...)')}`,
          value: 'manual',
          description: 'Ввести или скопировать существующий ключ из openrouter.ai/keys'
        }
      ]
    });

    if (!selectedMethod) {
      console.log(chalk.dim('(Отменено)\n'));
      return false;
    }
  }

  let key = null;

  if (selectedMethod === 'browser') {
    key = await loginViaBrowser();
    if (!key) {
      return false;
    }
  } else if (selectedMethod === 'manual') {
    console.log(chalk.dim('Получить ключ можно на: https://openrouter.ai/keys'));
    const inputKey = await password({
      message: `Введите API ключ OpenRouter (sk-or-...) ${chalk.dim('(Esc — отмена)')}:`,
      mask: '*'
    });

    if (inputKey === null || inputKey === false) {
      console.log(chalk.dim('(Отменено)\n'));
      return false;
    }

    const trimmed = inputKey.trim();
    if (!trimmed) {
      console.log(chalk.yellow('! Авторизация отменена, передан пустой ключ.\n'));
      return false;
    }
    key = trimmed;
  }

  if (key) {
    saveConfig({ apiKey: key });
    if (session.provider === 'openrouter') {
      session.apiKey = key;
      fetchKeyInfo(key, 'openrouter').then(info => {
        if (info) session.keyInfo = info;
      }).catch(() => {});
    }
    console.log(chalk.green('✓ Ключ OpenRouter успешно сохранен в ~/.config/duddy/config.json\n'));
    return true;
  }

  return false;
}

/**
 * Обработчик команды /login
 *
 * @param {object} session - Текущая сессия Duddy
 * @param {string} [args=''] - Аргументы команды (/login google, /login browser, /login sk-or-...)
 * @returns {Promise<boolean>}
 */
export async function handleLoginCommand(session, args = '') {
  const trimmedArgs = (args || '').trim();
  const lower = trimmedArgs.toLowerCase();

  if (lower === 'google' || lower === 'gemini' || lower === 'aistudio') {
    return await loginGoogleAiStudio(session);
  }

  if (lower === 'browser' || lower === 'web') {
    return await loginOpenRouter(session, 'browser');
  }

  if (trimmedArgs.startsWith('sk-or-')) {
    saveConfig({ apiKey: trimmedArgs });
    if (session.provider === 'openrouter') {
      session.apiKey = trimmedArgs;
      fetchKeyInfo(trimmedArgs, 'openrouter').then(info => {
        if (info) session.keyInfo = info;
      }).catch(() => {});
    }
    console.log(chalk.green('✓ Ключ OpenRouter успешно сохранен в ~/.config/duddy/config.json\n'));
    return true;
  }

  const choice = await select({
    message: 'Выберите способ авторизации:',
    choices: [
      {
        name: `🌐 ${chalk.bold.hex('#38bdf8')('OpenRouter')} — ${chalk.green('войти через браузер')}`,
        value: 'openrouter_browser'
      },
      {
        name: `🔑 ${chalk.bold.hex('#38bdf8')('OpenRouter')} — ${chalk.dim('вставить ключ')}`,
        value: 'openrouter_manual'
      },
      {
        name: `✦ ${chalk.bold.hex('#38bdf8')('Google AI Studio')} — ${chalk.hex('#10b981')('ключ Gemini API')}`,
        value: 'google'
      }
    ]
  });

  if (!choice) {
    console.log(chalk.dim('(Отменено)\n'));
    return false;
  }

  if (choice === 'openrouter_browser') {
    return await loginOpenRouter(session, 'browser');
  }

  if (choice === 'openrouter_manual') {
    return await loginOpenRouter(session, 'manual');
  }

  if (choice === 'google') {
    return await loginGoogleAiStudio(session);
  }

  return false;
}

/**
 * Применить выбор модели с проверкой наличия ключа провайдера
 *
 * @param {string} modelId - Идентификатор модели
 * @param {string} providerId - Идентификатор провайдера
 * @param {string} displayName - Отображаемое имя модели
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<boolean>}
 */
async function applyModelSelection(modelId, providerId, displayName, session) {
  const provider = getProvider(providerId);
  const config = loadConfig();
  let key = getProviderKey(provider.id, config);

  if (!key) {
    console.log(chalk.yellow(`Для модели ${chalk.bold(displayName || modelId)} требуется ключ ${provider.title}.`));
    let success = false;
    if (provider.id === 'google') {
      success = await loginGoogleAiStudio(session);
    } else {
      success = await loginOpenRouter(session);
    }

    if (!success) {
      console.log(chalk.yellow('Модель не изменена: ключ не настроен.\n'));
      return false;
    }

    const updatedConfig = loadConfig();
    key = getProviderKey(provider.id, updatedConfig) || session.apiKey;
  }

  session.provider = provider.id;
  session.apiKey = key;
  session.model = modelId;
  saveConfig({ provider: provider.id, model: modelId });

  try {
    session.contextLength = await getModelContextLength(modelId, provider.id, key);
  } catch {}

  const nameToShow = displayName || modelId;
  console.log(chalk.green(`✓ Модель: ${chalk.bold(nameToShow)} · ${chalk.dim(provider.title)}\n`));
  return true;
}

/**
 * Обработчик команды /model для переключения и поиска моделей
 *
 * @param {string} args - Аргументы команды (например, прямой ID модели)
 * @param {object} session - Текущая сессия Duddy
 */
export async function handleModelCommand(args, session) {
  const trimmedArgs = (args || '').trim();

  // Если передан прямой аргумент (например, /model gemini-3.8-flash или /model openai/gpt-4.1)
  if (trimmedArgs) {
    const provId = detectProviderForModel(trimmedArgs);
    await applyModelSelection(trimmedArgs, provId, trimmedArgs, session);
    return;
  }

  // Интерактивное меню без аргументов
  const config = loadConfig();
  const googleKey = getProviderKey('google', config);

  let extraGoogleModels = [];
  if (googleKey) {
    const spinner = ora({
      text: chalk.dim('Загрузка моделей Google AI Studio...'),
      color: 'cyan'
    }).start();

    try {
      const gModels = await listGoogleModels(googleKey);
      spinner.stop();
      const curatedIds = new Set(CURATED_MODELS.map(m => m.id));
      const candidates = gModels.filter(id => !curatedIds.has(id));
      extraGoogleModels = candidates.slice(0, 3).map(id => ({
        id,
        name: id,
        provider: 'google',
        note: 'AI Studio'
      }));
    } catch {
      spinner.stop();
      // Ошибки списка молча игнорировать
    }
  }

  let lastGoogleIndex = -1;
  for (let i = CURATED_MODELS.length - 1; i >= 0; i--) {
    if (CURATED_MODELS[i].provider === 'google') {
      lastGoogleIndex = i;
      break;
    }
  }

  const modelList = [];
  for (let i = 0; i < CURATED_MODELS.length; i++) {
    modelList.push(CURATED_MODELS[i]);
    if (i === lastGoogleIndex && extraGoogleModels.length > 0) {
      modelList.push(...extraGoogleModels);
    }
  }
  if (lastGoogleIndex === -1 && extraGoogleModels.length > 0) {
    modelList.push(...extraGoogleModels);
  }

  // Если текущая модель не в списке — добавить её первой строкой с ✓
  const isCurrentInList = modelList.some(m => m.id === session.model);
  if (!isCurrentInList) {
    const detectedProv = session.provider || detectProviderForModel(session.model);
    modelList.unshift({
      id: session.model,
      name: session.model,
      provider: detectedProv,
      note: 'текущая'
    });
  }

  const choices = modelList.map(item => {
    const current = item.id === session.model;
    const providerTitle = getProvider(item.provider).title;
    const line = `${current ? chalk.green('✓') : ' '} ${item.name.padEnd(18)} ${chalk.dim(providerTitle.padEnd(17))} ${chalk.dim(item.note)}`;
    return {
      name: line,
      value: item.id
    };
  });

  choices.push(new Separator());
  choices.push({
    name: '🔍 Другая модель…',
    value: '__other__'
  });

  const chosenId = await select({
    message: `Модель (сейчас: ${session.model}):`,
    choices,
    default: session.model
  });

  if (!chosenId) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  if (chosenId === '__other__') {
    const query = await input({
      message: `Название или ID модели ${chalk.dim('(Esc — отмена)')}:`
    });

    if (query === null || query === false) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    const searchSpinner = ora({
      text: chalk.dim(`Поиск "${trimmedQuery}"...`),
      color: 'cyan'
    }).start();

    const qLower = trimmedQuery.toLowerCase();
    const searchResults = [];

    // Поиск по моделям Google AI Studio (если есть ключ)
    if (googleKey) {
      try {
        const gModels = await listGoogleModels(googleKey);
        for (const gId of gModels) {
          if (gId.toLowerCase().includes(qLower)) {
            searchResults.push({
              id: gId,
              name: gId,
              provider: 'google'
            });
          }
        }
      } catch {}
    }

    // Поиск по каталогу OpenRouter
    try {
      const orModels = await searchOpenRouterModels(trimmedQuery);
      for (const m of orModels) {
        searchResults.push({
          id: m.id,
          name: m.name || m.id,
          provider: 'openrouter'
        });
      }
    } catch {}

    searchSpinner.stop();

    const limitedResults = searchResults.slice(0, 20);
    const searchChoices = limitedResults.map(item => {
      const pTitle = getProvider(item.provider).title;
      return {
        name: `${item.name} ${chalk.dim(`(${pTitle})`)}`,
        value: item
      };
    });

    if (searchChoices.length > 0) {
      searchChoices.push(new Separator());
    }

    const customProvider = detectProviderForModel(trimmedQuery);
    searchChoices.push({
      name: `Использовать «${trimmedQuery}» как ID модели`,
      value: {
        id: trimmedQuery,
        name: trimmedQuery,
        provider: customProvider
      }
    });

    const chosenSearchItem = await select({
      message: `Результаты поиска для "${trimmedQuery}":`,
      choices: searchChoices
    });

    if (!chosenSearchItem) {
      console.log(chalk.dim('(Отменено)\n'));
      return;
    }

    await applyModelSelection(chosenSearchItem.id, chosenSearchItem.provider, chosenSearchItem.name, session);
    return;
  }

  // Выбран пункт из основного списка
  const selectedItem = modelList.find(m => m.id === chosenId);
  if (selectedItem) {
    await applyModelSelection(selectedItem.id, selectedItem.provider, selectedItem.name, session);
  }
}

/**
 * Обработчик команды /help
 */
export function handleHelpCommand() {
  console.log(chalk.bold.cyan('\n⚡ Доступные слеш-команды:'));
  for (const cmd of AVAILABLE_COMMANDS) {
    console.log(`  ${chalk.yellow(cmd.cmd.padEnd(16))} ${chalk.dim('—')} ${cmd.desc}`);
  }
  console.log(chalk.dim('\n💡 Подсказка: введи / — появится список команд (↑↓ выбор, Tab подставить, Enter выполнить).'));
  console.log(chalk.bold.hex('#38bdf8')('\n🛠️  Файловые операции (AI Agent):'));
  console.log(chalk.dim('  Duddy умеет создавать папки, файлы, читать и точечно изменять код в файлах.'));
  console.log(chalk.dim('  Просто напишите в чат: "создай папку src/components", "прочитай package.json" и т.д.\n'));
}

/**
 * Обработчик команды /clear
 *
 * @param {object} session - Текущая сессия Duddy
 */
export function handleClearCommand(session) {
  console.clear();
  session.messages = [];
  if (session.toolCtx) {
    session.toolCtx.autoApprove = !!session.autoApprove;
  }
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

/**
 * Обработчик команды /usage
 *
 * @param {object} session - Текущая сессия Duddy
 */
export async function handleUsageCommand(session) {
  if (!session.contextLength) {
    try {
      session.contextLength = await getModelContextLength(session.model, session.provider, session.apiKey);
    } catch {}
  }

  const turns = session.messages.filter(m => m.role === 'user').length;
  const totalTokens = session.totalTokens ?? 0;
  const lastTokens = session.lastUsage?.total_tokens ?? 0;
  const maxContext = session.contextLength || 1000000;
  const remainingTokens = Math.max(0, maxContext - lastTokens);
  const contextUsedPct = Math.min(100, Math.max(0, Math.round((lastTokens / maxContext) * 100)));

  const histPct = Math.round((turns / MAX_HISTORY_TURNS) * 100);
  const provider = getProvider(session.provider);

  console.log(chalk.bold.cyan(`\n📊 Мониторинг лимитов и токенов (${provider.title}):`));
  console.log();

  // 1. Окно контекста активной модели (Context Window)
  console.log(chalk.bold(`  🧠 Окно контекста активной модели (${chalk.hex('#38bdf8')(session.model)}):`));
  console.log('  ' + makeProgressBar(contextUsedPct) + chalk.dim('  ·  ') +
    chalk.hex('#94a3b8')(`${lastTokens.toLocaleString('ru-RU')} из ${maxContext.toLocaleString('ru-RU')} tok`) +
    chalk.hex('#10b981')(` (${remainingTokens.toLocaleString('ru-RU')} свободно)`));
  console.log(chalk.dim(`  ↳ Занято в текущем контексте: ${chalk.bold.hex('#f59e0b')(lastTokens.toLocaleString('ru-RU'))} токенов (${contextUsedPct}%)`));
  console.log(chalk.dim(`  ↳ Осталось свободно в окне модели: ${chalk.bold.hex('#10b981')(remainingTokens.toLocaleString('ru-RU'))} токенов (${100 - contextUsedPct}%)\n`));

  // 2. Дневной лимит бесплатных запросов (если есть - только для OpenRouter)
  if (session.keyInfo?.free_model_daily_requests) {
    const { remaining, limit, used } = session.keyInfo.free_model_daily_requests;
    const freePct = Math.round((used / limit) * 100);
    const timeUntilReset = getTimeUntilMidnightUTC();
    console.log(chalk.bold('  🌟 Дневной лимит бесплатных запросов (Daily Free):'));
    console.log('  ' + makeProgressBar(freePct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${used} из ${limit} запросов`) + chalk.hex('#10b981')(` (${remaining} осталось)`));
    console.log(chalk.dim(`  ↳ Сбрасывается каждые сутки в 00:00 UTC (до сброса осталось: ${chalk.hex('#38bdf8')(timeUntilReset)})\n`));
  }

  // 3. Периодический расход аккаунта (если есть - только для OpenRouter)
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
  console.log('  ' + makeProgressBar(histPct) + chalk.dim('  ·  ') + chalk.hex('#94a3b8')(`${turns} из ${MAX_HISTORY_TURNS} ходов`));
  console.log(chalk.dim(`  ↳ Запросов в текущем сеансе: ${chalk.bold(turns)}`));
  console.log(chalk.dim(`  ↳ Всего токенов обработано за сессию (счётчик): ${chalk.hex('#f59e0b')(`${totalTokens.toLocaleString('ru-RU')} tok`)}\n`));
}

/**
 * Обработчик команды /effort для переключения уровня рассуждений модели
 *
 * @param {string} args - Аргументы команды (auto, low, medium, high)
 * @param {object} session - Текущая сессия Duddy
 */
export async function handleEffortCommand(args, session) {
  const validEfforts = ['auto', 'low', 'medium', 'high'];
  const trimmed = (args || '').trim().toLowerCase();

  if (trimmed) {
    if (!validEfforts.includes(trimmed)) {
      console.log(chalk.yellow(`Неизвестный уровень рассуждений: "${trimmed}". Допустимые: auto, low, medium, high\n`));
      return;
    }
    session.reasoningEffort = trimmed;
    saveConfig({ reasoningEffort: trimmed });
    console.log(chalk.green(`✓ Уровень рассуждений: ${trimmed}\n`));
    return;
  }

  const current = session.reasoningEffort || 'auto';
  const effortOptions = [
    { value: 'auto', label: 'auto — по умолчанию модели' },
    { value: 'low', label: 'low — быстро, меньше размышлений' },
    { value: 'medium', label: 'medium — баланс' },
    { value: 'high', label: 'high — максимум качества, медленнее' }
  ];

  const choices = effortOptions.map(opt => ({
    name: `${opt.value === current ? chalk.green('✓') : ' '} ${opt.label}`,
    value: opt.value
  }));

  const chosen = await select({
    message: `Уровень рассуждений (сейчас: ${current}):`,
    choices,
    default: current
  });

  if (!chosen) {
    console.log(chalk.dim('(Отменено)\n'));
    return;
  }

  session.reasoningEffort = chosen;
  saveConfig({ reasoningEffort: chosen });
  console.log(chalk.green(`✓ Уровень рассуждений: ${chosen}\n`));
}
