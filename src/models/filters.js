/**
 * @fileoverview Фильтрация моделей по параметрам, возрасту и правилам сортировки
 */

// Максимальный возраст модели в каталоге (2 года)
export const MAX_MODEL_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export const GOOGLE_EXCLUDED_SUBSTRINGS = [
  'tts',
  'image',
  'banana',
  'lyria',
  'robotics',
  'deep-research',
  'antigravity',
  'computer-use',
  'transcribe',
  'customtools',
  'embedding',
  'aqa'
];

export const MIN_CODE_MODEL_PARAMS_B = 20;

/**
 * Модель слишком слабая для работы с кодом
 *
 * @param {string} id - Идентификатор модели
 * @returns {boolean}
 */
export function isCodeUnfit(id) {
  if (!id) return false;
  const cleanId = String(id).toLowerCase().replace(/^~/, '');
  const name = cleanId.includes('/') ? cleanId.slice(cleanId.lastIndexOf('/') + 1) : cleanId;

  // Общее число параметров меньше 20B
  const paramMatch = name.match(/(?:^|[-_.])(\d+(?:\.\d+)?)([bt])(?=$|[-_:.])/);
  if (paramMatch) {
    const val = parseFloat(paramMatch[1]);
    const multiplier = paramMatch[2] === 't' ? 1000 : 1;
    if (val * multiplier < MIN_CODE_MODEL_PARAMS_B) {
      return true;
    }
  }

  // В name есть отдельный сегмент nano, micro или edge
  if (/(^|[-_.])(nano|micro|edge)([-_:.]|$)/.test(name)) {
    return true;
  }

  // В name есть "flash-lite" (лёгкие Gemini, слабы для кода)
  if (name.includes('flash-lite')) {
    return true;
  }

  // id начинается с "liquid/" (крошечные модели Liquid)
  if (cleanId.startsWith('liquid/')) {
    return true;
  }

  // Чат-версии OpenAI
  if (/^openai\/gpt-.*chat/.test(cleanId)) {
    return true;
  }

  return false;
}

function isGemma(id) {
  return id.toLowerCase().startsWith('gemma');
}

function isLatest(id) {
  return id.toLowerCase().includes('-latest');
}

function getTier(id) {
  const lower = id.toLowerCase();
  if (lower.includes('pro')) return 1;
  if (lower.includes('flash-lite') || lower.includes('flash_lite') || lower.includes('lite')) return 3;
  if (lower.includes('flash')) return 2;
  return 4;
}

function getVersion(id) {
  const match = id.match(/\d+(?:\.\d+)*/);
  return match ? match[0] : '';
}

/**
 * Сортировка моделей Google Gemini согласно правилам
 *
 * @param {Array<object>} models - Массив отфильтрованных моделей Google
 * @returns {Array<object>}
 */
export function sortGoogleModels(models) {
  return [...models].sort((a, b) => {
    const aId = a.id;
    const bId = b.id;

    // gemma-* в конце
    const aGemma = isGemma(aId);
    const bGemma = isGemma(bId);
    if (aGemma !== bGemma) {
      return aGemma ? 1 : -1;
    }
    if (aGemma && bGemma) {
      return bId.localeCompare(aId, undefined, { numeric: true });
    }

    // Сначала алиасы с '-latest' (Pro → Flash → Flash-Lite)
    const aLatest = isLatest(aId);
    const bLatest = isLatest(bId);
    if (aLatest !== bLatest) {
      return aLatest ? -1 : 1;
    }
    if (aLatest && bLatest) {
      const tierDiff = getTier(aId) - getTier(bId);
      if (tierDiff !== 0) return tierDiff;
      return bId.localeCompare(aId, undefined, { numeric: true });
    }

    // Затем остальные по убыванию версии
    const aVer = getVersion(aId);
    const bVer = getVersion(bId);
    if (aVer && bVer && aVer !== bVer) {
      const verDiff = bVer.localeCompare(aVer, undefined, { numeric: true });
      if (verDiff !== 0) return verDiff;
    } else if (aVer && !bVer) {
      return -1;
    } else if (!aVer && bVer) {
      return 1;
    }

    // Внутри одной версии Pro раньше Flash раньше Lite
    const tierDiff = getTier(aId) - getTier(bId);
    if (tierDiff !== 0) return tierDiff;

    return bId.localeCompare(aId, undefined, { numeric: true });
  });
}
