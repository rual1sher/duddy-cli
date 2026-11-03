/**
 * @fileoverview Цветовые темы оформления интерфейса Duddy (тёмные, светлые, для дальтоников)
 */

import chalk from 'chalk';

/**
 * @typedef {object} Theme
 * @property {string} title - Название темы
 * @property {string} hint - Подсказка для выбора темы
 * @property {boolean} dark - Флаг тёмной темы
 * @property {string} background - Цвет фона терминала для предпросмотра
 * @property {Record<string, string>} colors - Цветовая палитра темы
 */

/** @type {Record<string, Theme>} */
export const THEMES = {
  dark: {
    title: 'Тёмная',
    hint: 'для тёмного фона терминала',
    dark: true,
    background: '#0b1120',
    colors: {
      accent: '#38bdf8',
      text: '#f8fafc',
      muted: '#94a3b8',
      subtle: '#64748b',
      faint: '#475569',
      border: '#334155',
      surface: '#1e293b',
      inverse: '#0f172a',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      diffAddFg: '#dcfce7',
      diffAddBg: '#14532d',
      diffDelFg: '#fee2e2',
      diffDelBg: '#7f1d1d'
    }
  },
  'dark-colorblind': {
    title: 'Тёмная для дальтоников',
    hint: 'для тёмного фона · diff синий/оранжевый',
    dark: true,
    background: '#0b1120',
    colors: {
      accent: '#38bdf8',
      text: '#f8fafc',
      muted: '#94a3b8',
      subtle: '#64748b',
      faint: '#475569',
      border: '#334155',
      surface: '#1e293b',
      inverse: '#0f172a',
      success: '#3b82f6',
      warning: '#f59e0b',
      error: '#f97316',
      diffAddFg: '#dbeafe',
      diffAddBg: '#1e3a8a',
      diffDelFg: '#ffedd5',
      diffDelBg: '#7c2d12'
    }
  },
  light: {
    title: 'Светлая',
    hint: 'для светлого фона терминала',
    dark: false,
    background: '#ffffff',
    colors: {
      accent: '#0369a1',
      text: '#0f172a',
      muted: '#475569',
      subtle: '#64748b',
      faint: '#94a3b8',
      border: '#cbd5e1',
      surface: '#e2e8f0',
      inverse: '#ffffff',
      success: '#15803d',
      warning: '#b45309',
      error: '#b91c1c',
      diffAddFg: '#14532d',
      diffAddBg: '#dcfce7',
      diffDelFg: '#7f1d1d',
      diffDelBg: '#fee2e2'
    }
  },
  'light-colorblind': {
    title: 'Светлая для дальтоников',
    hint: 'для светлого фона · diff синий/оранжевый',
    dark: false,
    background: '#ffffff',
    colors: {
      accent: '#0369a1',
      text: '#0f172a',
      muted: '#475569',
      subtle: '#64748b',
      faint: '#94a3b8',
      border: '#cbd5e1',
      surface: '#e2e8f0',
      inverse: '#ffffff',
      success: '#1d4ed8',
      warning: '#b45309',
      error: '#c2410c',
      diffAddFg: '#1e3a8a',
      diffAddBg: '#dbeafe',
      diffDelFg: '#7c2d12',
      diffDelBg: '#ffedd5'
    }
  }
};

export const THEME_IDS = ['dark', 'dark-colorblind', 'light', 'light-colorblind'];
export const DEFAULT_THEME = 'dark';

let currentThemeId = DEFAULT_THEME;

/**
 * Устанавливает активную цветовую тему по идентификатору.
 * Неизвестный идентификатор сбрасывается в DEFAULT_THEME.
 *
 * @param {string} id - Идентификатор темы
 * @returns {string} Применённый идентификатор темы
 */
export function setTheme(id) {
  if (id && Object.prototype.hasOwnProperty.call(THEMES, id)) {
    currentThemeId = id;
  } else {
    currentThemeId = DEFAULT_THEME;
  }
  return currentThemeId;
}

/**
 * Возвращает текущий идентификатор темы.
 *
 * @returns {string}
 */
export function getThemeId() {
  return currentThemeId;
}

/**
 * Возвращает объект цветов текущей темы.
 *
 * @returns {Record<string, string>}
 */
export function theme() {
  return THEMES[currentThemeId].colors;
}

/**
 * Возвращает функцию стилизации chalk для указанного токена палитры.
 *
 * @param {string} token - Имя токена (accent, text, muted, success и т.д.)
 * @returns {import('chalk').ChalkInstance}
 */
export function paint(token) {
  return chalk.hex(theme()[token]);
}
