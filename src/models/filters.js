/**
 * @fileoverview Фильтрация моделей по параметрам, возрасту и правилам сортировки
 */

// Максимальный возраст модели в каталоге (2 года)
export const MAX_MODEL_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

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
