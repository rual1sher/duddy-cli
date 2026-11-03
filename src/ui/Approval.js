/**
 * @fileoverview Компонент подтверждения файловых операций агента
 */

import React, { useState } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import { theme } from '../theme.js';

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
 * @param {boolean} [props.sensitive=false] - Действие может раскрыть секреты или навредить: нет варианта «на всю сессию», по умолчанию выбрано «Нет»
 * @param {'file'|'command'} [props.scope='file'] - Что покрывает вариант «на всю сессию»
 * @param {(choice: 'yes'|'all'|'no') => void} props.onResolve - Резолв подтверждения
 * @returns {React.ReactElement}
 */
export function Approval({ name, relPath, preview = [], sensitive = false, scope = 'file', onResolve }) {
  const t = theme();
  const allLabel = scope === 'command' ? 'Да, и не спрашивать эту команду в этой сессии' : 'Да, и не спрашивать в этой сессии';
  const choices = (sensitive ? CHOICES.filter(c => c.value !== 'all') : CHOICES)
    .map(c => (c.value === 'all' ? { ...c, label: allLabel } : c));
  const [selectedIndex, setSelectedIndex] = useState(sensitive ? choices.length - 1 : 0);

  // Без слушателя Ink отдал бы вставку в useInput, и текст «y» из буфера подтвердил бы действие
  usePaste(() => {});

  useInput((input, key) => {
    if (key.escape || input === 'n' || input === 'N') {
      if (typeof onResolve === 'function') onResolve('no');
      return;
    }

    if (input === 'y' || input === 'Y') {
      if (typeof onResolve === 'function') onResolve('yes');
      return;
    }

    if (!sensitive && (input === 'a' || input === 'A')) {
      if (typeof onResolve === 'function') onResolve('all');
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + choices.length) % choices.length);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % choices.length);
      return;
    }

    if (key.return) {
      if (typeof onResolve === 'function') {
        onResolve(choices[selectedIndex].value);
      }
    }
  });

  return h(
    Box,
    {
      borderStyle: 'round',
      borderColor: t.warning,
      paddingX: 1,
      flexDirection: 'column',
      width: '100%'
    },
    h(Text, { bold: true, color: t.warning }, `Разрешить ${name}: ${relPath}?`),
    preview.length > 0
      ? h(
          Box,
          { flexDirection: 'column', marginTop: 1, marginBottom: 1 },
          preview.map((item, idx) => {
            if (item.kind === 'del') {
              const rawLine = `- ${item.text || ''}`;
              const truncated = rawLine.slice(0, 140);
              return h(Text, { key: idx, color: t.diffDelFg, backgroundColor: t.diffDelBg, wrap: 'truncate-end' }, truncated);
            }
            if (item.kind === 'add') {
              const rawLine = `+ ${item.text || ''}`;
              const truncated = rawLine.slice(0, 140);
              return h(Text, { key: idx, color: t.diffAddFg, backgroundColor: t.diffAddBg, wrap: 'truncate-end' }, truncated);
            }
            if (item.kind === 'warn') {
              return h(Text, { key: idx, color: t.warning }, item.text);
            }
            if (item.kind === 'info') {
              return h(Text, { key: idx, bold: true, color: t.text }, item.text);
            }
            return h(Text, { key: idx, color: t.muted }, item.text);
          })
        )
      : null,
    h(
      Box,
      { flexDirection: 'column', marginTop: preview.length > 0 ? 0 : 1 },
      choices.map((c, i) => {
        const isSelected = i === selectedIndex;
        return h(
          Box,
          { key: c.value, flexDirection: 'row' },
          h(Text, { color: isSelected ? t.accent : t.subtle }, isSelected ? '❯ ' : '  '),
          h(
            Text,
            { bold: isSelected, color: isSelected ? t.accent : t.text },
            c.label
          )
        );
      })
    ),
    h(
      Box,
      { marginTop: 1 },
      h(
        Text,
        { color: t.subtle, dimColor: true },
        sensitive
          ? 'y — да · n / Esc — нет · ↑↓ Enter'
          : `y — да · a — ${scope === 'command' ? 'да для этой команды' : 'да на всю сессию'} · n / Esc — нет · ↑↓ Enter`
      )
    )
  );
}
