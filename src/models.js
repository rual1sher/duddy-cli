/**
 * @fileoverview Каталог моделей и поиск для Duddy CLI
 */

/**
 * Кураторский список рекомендуемых моделей
 */
export const CURATED_MODELS = [
  { id: 'openrouter/free', name: 'Auto Free', provider: 'openrouter', note: 'бесплатно' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'google', note: 'бесплатно · быстро' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google', note: 'бесплатно · бывает перегружена' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'openrouter', note: 'платно' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openrouter', note: 'платно' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'openrouter', note: 'дёшево' }
];

/**
 * Поиск моделей в онлайн-каталоге OpenRouter
 *
 * @param {string} query - Поисковый запрос
 * @returns {Promise<Array<{ id: string, name: string, description?: string }>>} Найденные модели
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
