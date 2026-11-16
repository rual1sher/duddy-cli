/**
 * @fileoverview Всплывающее меню вариантов слэш-команд под полем ввода
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../render/theme.js';

const h = React.createElement;

/**
 * Компонент меню доступных команд
 *
 * @param {object} props
 * @param {Array<{ cmd: string, desc: string }>} props.filteredCommands - Отфильтрованные команды
 * @param {number} props.commandIndex - Индекс активного элемента меню
 * @returns {React.ReactElement}
 */
export function CommandMenu({ filteredCommands, commandIndex }) {
  const t = theme();

  return h(
    Box,
    { flexDirection: 'column', paddingLeft: 1 },
    filteredCommands.length > 0
      ? filteredCommands.map((item, idx) => {
          const isSelected = idx === commandIndex;
          if (isSelected) {
            return h(
              Box,
              { key: item.cmd, flexDirection: 'row' },
              h(Text, { color: t.accent }, '❯ '),
              h(Text, { bold: true, color: t.accent }, item.cmd.padEnd(10) + '  '),
              h(Text, { color: t.muted }, item.desc)
            );
          }
          return h(
            Box,
            { key: item.cmd, flexDirection: 'row' },
            h(Text, null, '  '),
            h(Text, { color: t.subtle }, item.cmd.padEnd(10) + '  '),
            h(Text, { color: t.subtle, dimColor: true }, item.desc)
          );
        })
      : h(Text, { color: t.subtle, dimColor: true }, '  нет такой команды')
  );
}
