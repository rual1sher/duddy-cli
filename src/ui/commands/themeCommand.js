/**
 * @fileoverview Команда выбора цветовой темы интерфейса (/theme)
 */

import React from 'react';
import { THEMES, THEME_IDS, getThemeId, setTheme } from '../../render/theme.js';
import { loadConfig, saveConfig } from '../../session/config.js';
import { clearScreenToTop } from '../hooks/useResizeRedraw.js';
import { ThemePreview } from '../ThemePreview.js';

const h = React.createElement;

/**
 * Открывает интерактивное меню выбора цветовой темы.
 *
 * @param {object} ctx - Контекст команд TUI
 * @param {object} [options] - Дополнительные параметры
 * @param {() => void} [options.onDone] - Колбэк завершения выбора
 */
export function openThemePicker(ctx, { onDone } = {}) {
  const { setOverlay, setStaticKey, addNote } = ctx;
  const items = THEME_IDS.map(id => ({
    label: THEMES[id].title,
    hint: THEMES[id].hint,
    value: id,
    current: loadConfig().theme === id
  }));

  setOverlay({
    kind: 'picker',
    title: 'Выбор темы',
    items,
    initialValue: getThemeId(),
    renderPreview: (id) => h(ThemePreview, { themeId: id }),
    onSelect: (id) => {
      setOverlay(null);
      setTheme(id);
      saveConfig({ theme: id });
      process.stdout.write(clearScreenToTop());
      setStaticKey(k => k + 1);
      addNote('success', `Тема: ${THEMES[id].title}`);
      onDone?.();
    },
    onCancel: () => {
      setOverlay(null);
      onDone?.();
    }
  });
}
