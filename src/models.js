import chalk from 'chalk';

export const MODEL_CATEGORIES = {
  free: {
    key: 'free',
    title: `${chalk.bold.yellow('🌟 100% Бесплатные модели')} ${chalk.green('(Free Tier)')}`,
    description: 'Работают с любым бесплатным ключом OpenRouter (без привязки карты и баланса)',
    models: [
      {
        id: 'openrouter/free',
        name: 'Auto Free Router',
        badge: chalk.bold.green('FREE'),
        desc: 'Автоматически выбирает лучшую доступную бесплатную модель в реальном времени'
      },
      {
        id: 'google/gemma-4-31b-it:free',
        name: 'Google Gemma 4 31B',
        badge: chalk.bold.green('FREE'),
        desc: 'Официальная модель от Google: отличный русский язык, логика и код'
      },
      {
        id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        name: 'NVIDIA Nano Omni 30B',
        badge: chalk.bold.green('FREE'),
        desc: 'Флагман для программирования, DevOps и точных пошаговых решений'
      },
      {
        id: 'nvidia/nemotron-3.5-lightning:free',
        name: 'NVIDIA 3.5 Lightning',
        badge: chalk.bold.green('FREE'),
        desc: 'Сверхбыстрый отклик (<400ms) для мгновенных ответов'
      },
      {
        id: 'liquid/lfm-2.5-2.6b:free',
        name: 'LiquidAI LFM 2.6B',
        badge: chalk.bold.green('FREE'),
        desc: 'Ультра-легковесная и быстрая модель для простых задач'
      }
    ]
  },
  google: {
    key: 'google',
    title: `${chalk.bold.hex('#4285F4')('🧠 Google')} ${chalk.hex('#34A853')('(Gemini)')}`,
    description: 'Флагманские мультимодальные модели Google с колоссальным окном контекста',
    requiresCredits: true,
    models: [
      {
        id: 'google/gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        badge: chalk.hex('#4285F4')('Google'),
        desc: 'Новейший флагман Google: рекордная скорость и глубокое понимание'
      },
      {
        id: 'google/gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        badge: chalk.hex('#4285F4')('Google'),
        desc: 'Идеальный баланс интеллекта, генерации кода и скорости ответа'
      },
      {
        id: 'google/gemini-3.5-flash-lite',
        name: 'Gemini 3.5 Flash Lite',
        badge: chalk.hex('#4285F4')('Google'),
        desc: 'Супер-экономичная модель Google с минимальным расходом'
      },
      {
        id: 'google/gemma-4-31b-it:free',
        name: 'Google Gemma 4 31B (Free)',
        badge: chalk.bold.green('FREE'),
        desc: 'Бесплатная открытая модель Google (не требует баланса)'
      }
    ]
  },
  openai: {
    key: 'openai',
    title: `${chalk.bold.hex('#10a37f')('⚡ OpenAI')} ${chalk.hex('#74aa9c')('(GPT-4 / GPT-5)')}`,
    description: 'Мировой стандарт интеллекта, логики, математики и решения сложных задач',
    requiresCredits: true,
    models: [
      {
        id: 'openai/gpt-4.1',
        name: 'GPT-4.1',
        badge: chalk.hex('#10a37f')('OpenAI'),
        desc: 'Новейший флагман OpenAI: бескомпромиссное качество генерации'
      },
      {
        id: 'openai/gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        badge: chalk.hex('#10a37f')('OpenAI'),
        desc: 'Быстрая, легкая и точная модель нового поколения'
      },
      {
        id: 'openai/gpt-4o-2024-11-20',
        name: 'GPT-4o',
        badge: chalk.hex('#10a37f')('OpenAI'),
        desc: 'Классический мультимодальный флагман OpenAI'
      },
      {
        id: 'openai/o3-mini',
        name: 'o3-mini',
        badge: chalk.hex('#10a37f')('OpenAI'),
        desc: 'Модель глубоких пошаговых рассуждений (Reasoning)'
      }
    ]
  },
  anthropic: {
    key: 'anthropic',
    title: `${chalk.bold.hex('#d97706')('🎭 Anthropic')} ${chalk.hex('#f59e0b')('(Claude)')}`,
    description: 'Лучшие в мире модели для архитектуры ПО, чистого кода и рефакторинга',
    requiresCredits: true,
    models: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        name: 'Claude Sonnet 4.6',
        badge: chalk.hex('#d97706')('Claude'),
        desc: 'Номер 1 в мире для программирования, сложных систем и документации'
      },
      {
        id: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        badge: chalk.hex('#d97706')('Claude'),
        desc: 'Молниеносный отклик, идеален для быстрых консультаций'
      },
      {
        id: 'anthropic/claude-opus-4.6',
        name: 'Claude Opus 4.6',
        badge: chalk.hex('#d97706')('Claude'),
        desc: 'Максимальный аналитический интеллект для самых трудных задач'
      },
      {
        id: 'anthropic/claude-3-haiku',
        name: 'Claude 3 Haiku',
        badge: chalk.hex('#d97706')('Claude'),
        desc: 'Проверенная временем супер-быстрая и экономичная модель'
      }
    ]
  },
  meta: {
    key: 'meta',
    title: `${chalk.bold.hex('#0668E1')('🦙 Meta')} ${chalk.hex('#0081FB')('(Llama)')}`,
    description: 'Лидирующие модели с открытыми весами от Meta AI',
    requiresCredits: true,
    models: [
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B Instruct',
        badge: chalk.hex('#0668E1')('Meta'),
        desc: 'Мощнейшая модель с открытыми весами: уровень GPT-4o по доступной цене'
      },
      {
        id: 'meta-llama/llama-4-scout',
        name: 'Llama 4 Scout',
        badge: chalk.hex('#0668E1')('Meta'),
        desc: 'Следующее поколение архитектуры Llama от Meta'
      },
      {
        id: 'meta-llama/llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B Instruct',
        badge: chalk.hex('#0668E1')('Meta'),
        desc: 'Компактная, сверхбыстрая и очень дешевая модель'
      }
    ]
  },
  deepseek: {
    key: 'deepseek',
    title: `${chalk.bold.hex('#4f46e5')('🐋 DeepSeek')} ${chalk.hex('#818cf8')('(V3 & R1)')}`,
    description: 'Высокоэффективные модели с непревзойденной логикой по выгодной цене',
    requiresCredits: true,
    models: [
      {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek V3',
        badge: chalk.hex('#4f46e5')('DeepSeek'),
        desc: 'Флагманское качество генерации и кодинга по ультра-доступной цене'
      },
      {
        id: 'deepseek/deepseek-r1',
        name: 'DeepSeek R1',
        badge: chalk.hex('#4f46e5')('DeepSeek'),
        desc: 'Продвинутое пошаговое рассуждение и решение сложных алгоритмов'
      }
    ]
  }
};

/**
 * Returns a flat list of all featured curated models
 */
export function getAllCuratedModels() {
  const all = [];
  for (const cat of Object.values(MODEL_CATEGORIES)) {
    for (const m of cat.models) {
      if (!all.some(x => x.id === m.id)) {
        all.push({ ...m, category: cat.key });
      }
    }
  }
  return all;
}

/**
 * Search online OpenRouter models by query
 */
export async function searchOpenRouterModels(query) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) return [];
    const json = await res.json();
    const list = json.data || [];
    const q = query.toLowerCase().trim();
    return list.filter(m =>
      m.id.toLowerCase().includes(q) ||
      (m.name && m.name.toLowerCase().includes(q))
    ).slice(0, 25);
  } catch (err) {
    return [];
  }
}
