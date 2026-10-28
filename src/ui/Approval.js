/**
 * @fileoverview Компонент подтверждения файловых операций агента
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const h = React.createElement;

const CHOICES = [
  { label: 'Да', value: 'yes' },
  { label: 'Да, и не спрашивать в этой сессии', value: 'all' },
  { label: 'Нет', value: 'no' }
];

/**
 * Компонент диалога подтверждения действий над файлами
 *
 * @param {object} props
 * @param {string} props.name - Название инструмента (create_file, edit_file и др.)
 * @param {string} props.relPath - Относительный путь к целевому файлу
 * @param {Array<object>} [props.preview=[]] - Список строк предпросмотра
 * @param {(choice: 'yes'|'all'|'no') => void} props.onResolve - Резолв подтверждения
 * @returns {React.ReactElement}
 */
export function Approval({ name, relPath, preview = [], onResolve }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'n' || input === 'N') {
      if (typeof onResolve === 'function') onResolve('no');
      return;
    }

    if (input === 'y' || input === 'Y') {
      if (typeof onResolve === 'function') onResolve('yes');
      return;
    }

    if (input === 'a' || input === 'A') {
      if (typeof onResolve === 'function') onResolve('all');
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + CHOICES.length) % CHOICES.length);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % CHOICES.length);
      return;
    }

    if (key.return) {
      if (typeof onResolve === 'function') {
        onResolve(CHOICES[selectedIndex].value);
      }
    }
  });

  return h(
    Box,
    {
      borderStyle: 'round',
      borderColor: '#f59e0b',
      paddingX: 1,
      flexDirection: 'column',
      width: '100%'
    },
    h(Text, { bold: true, color: '#f59e0b' }, `Разрешить ${name}: ${relPath}?`),
    preview.length > 0
      ? h(
          Box,
          { flexDirection: 'column', marginTop: 1, marginBottom: 1 },
          preview.map((item, idx) => {
            if (item.kind === 'del') {
              return h(Text, { key: idx, color: '#ef4444' }, `- ${item.text}`);
            }
            if (item.kind === 'add') {
              return h(Text, { key: idx, color: '#10b981' }, `+ ${item.text}`);
            }
            if (item.kind === 'warn') {
              return h(Text, { key: idx, color: '#f59e0b' }, item.text);
            }
            if (item.kind === 'info') {
              return h(Text, { key: idx, bold: true, color: '#f8fafc' }, item.text);
            }
            return h(Text, { key: idx, color: '#94a3b8' }, item.text);
          })
        )
      : null,
    h(
      Box,
      { flexDirection: 'column', marginTop: preview.length > 0 ? 0 : 1 },
      CHOICES.map((c, i) => {
        const isSelected = i === selectedIndex;
        return h(
          Box,
          { key: c.value, flexDirection: 'row' },
          h(Text, { color: isSelected ? '#38bdf8' : '#64748b' }, isSelected ? '❯ ' : '  '),
          h(
            Text,
            { bold: isSelected, color: isSelected ? '#38bdf8' : '#f8fafc' },
            c.label
          )
        );
      })
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: '#64748b', dimColor: true }, 'y — да · a — да на всю сессию · n / Esc — нет · ↑↓ Enter')
    )
  );
}
