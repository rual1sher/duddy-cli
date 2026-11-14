/**
 * @fileoverview Компонент сообщения пользователя в истории диалога с корректным переносом строк
 */

import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { theme } from '../theme.js';
import { wrapInput } from './wrapInput.js';

const h = React.createElement;

/**
 * Рендерит сообщение пользователя с префиксом '> ' и выравниванием перенесённых строк
 *
 * @param {object} props
 * @param {string} props.text - Текст сообщения пользователя
 * @returns {React.ReactElement}
 */
export function UserMessage({ text }) {
  const t = theme();
  const windowSize = useWindowSize();
  const columns = windowSize?.columns || process.stdout.columns || 80;
  const width = Math.max(10, columns - 2);

  const raw = typeof text === 'string' ? text : '';
  const ranges = wrapInput(raw, width);
  const lines = ranges.map(r => raw.slice(r.start, r.end).replace(/\r?\n$/, ''));

  return h(
    Box,
    { flexDirection: 'row' },
    h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: t.subtle }, '> ')),
    h(
      Box,
      { flexDirection: 'column' },
      lines.map((line, i) =>
        h(Text, { key: i, color: t.text, wrap: 'truncate-end' }, line || ' ')
      )
    )
  );
}

export default UserMessage;
