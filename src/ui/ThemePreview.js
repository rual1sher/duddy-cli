/**
 * @fileoverview Компонент живого предпросмотра темы оформления
 */

import React from 'react';
import { Box, Text } from 'ink';
import { THEMES } from '../render/theme.js';

const h = React.createElement;

/**
 * Отрисовывает предпросмотр темы с примерами текста, изменений diff и палитры цветов
 *
 * @param {object} props
 * @param {string} props.themeId - Идентификатор темы
 * @returns {React.ReactElement}
 */
export function ThemePreview({ themeId }) {
  const currentTheme = THEMES[themeId] || THEMES.dark;
  const c = currentTheme.colors;

  return h(
    Box,
    {
      flexDirection: 'column',
      backgroundColor: currentTheme.background,
      paddingX: 1,
      paddingY: 0,
      width: '100%'
    },
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: c.success }, '⏺ '),
      h(Text, { bold: true, color: c.text }, 'Изменён'),
      h(Text, { color: c.muted }, ' src/app.js')
    ),
    h(Text, { color: c.muted, wrap: 'truncate-end' }, '  ⎿  +2 −1 строк'),
    h(Text, { color: c.muted, wrap: 'truncate-end' }, '     function greet(name) {'),
    h(
      Text,
      { wrap: 'truncate-end' },
      '     ',
      h(Text, { color: c.diffDelFg, backgroundColor: c.diffDelBg }, '- return "Hello " + name;')
    ),
    h(
      Text,
      { wrap: 'truncate-end' },
      '     ',
      h(Text, { color: c.diffAddFg, backgroundColor: c.diffAddBg }, '+ const msg = `Привет, ${name}!`;')
    ),
    h(
      Text,
      { wrap: 'truncate-end' },
      '     ',
      h(Text, { color: c.diffAddFg, backgroundColor: c.diffAddBg }, '+ return msg;')
    ),
    h(Text, { color: c.muted, wrap: 'truncate-end' }, '     }'),
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { bold: true, color: c.accent }, 'Duddy'),
      h(Text, { color: c.text }, '  текст'),
      h(Text, { color: c.muted }, '  приглушённый'),
      h(Text, { color: c.success }, '  ✓ готово'),
      h(Text, { color: c.warning }, '  ⚠ внимание'),
      h(Text, { color: c.error }, '  ✖ ошибка')
    )
  );
}
