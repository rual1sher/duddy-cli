/**
 * @fileoverview Компонент диалога выбора с поддержкой поиска и пагинации
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../render/theme.js';

const h = React.createElement;

const PAGE_SIZE = 10;

/**
 * Компонент интерактивного выбора элементов
 *
 * @param {object} props
 * @param {string} props.title - Заголовок меню
 * @param {Array<object>} props.items - Список элементов { label, hint, value, current, group }
 * @param {boolean} [props.searchable=false] - Включить строку поиска
 * @param {(value: any) => void} props.onSelect - Колбэк выбора
 * @param {() => void} props.onCancel - Колбэк отмены
 * @param {any} [props.initialValue] - Начальное значение для установки фокуса
 * @param {(value: any) => React.ReactElement} [props.renderPreview] - Функция отрисовки предпросмотра выбранного элемента
 * @returns {React.ReactElement}
 */
export function Picker({
  title,
  items = [],
  searchable = false,
  onSelect,
  onCancel,
  initialValue,
  renderPreview
}) {
  const t = theme();
  const [query, setQuery] = useState('');

  const initialIndex = useMemo(() => {
    const idx = items.findIndex(
      it =>
        it.current ||
        it.value === initialValue ||
        (it.value && initialValue && it.value.id === initialValue)
    );
    return idx >= 0 ? idx : 0;
  }, [items, initialValue]);

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) {
      return items;
    }
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return items.filter(it => {
      const text = `${it.label || ''} ${it.hint || ''} ${it.group || ''}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
  }, [items, searchable, query]);

  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useInput((input, key) => {
    if (key.escape) {
      if (typeof onCancel === 'function') onCancel();
      return;
    }

    if (key.return) {
      if (filtered[selectedIndex]?.disabled) {
        return;
      }
      if (filtered[selectedIndex] && typeof onSelect === 'function') {
        onSelect(filtered[selectedIndex].value);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filtered.length - 1, prev + 1));
      return;
    }

    if (key.pageUp) {
      setSelectedIndex(prev => Math.max(0, prev - PAGE_SIZE));
      return;
    }

    if (key.pageDown) {
      setSelectedIndex(prev => Math.min(filtered.length - 1, prev + PAGE_SIZE));
      return;
    }

    if (searchable) {
      if (key.backspace || key.delete) {
        setQuery(prev => prev.slice(0, -1));
        setSelectedIndex(0);
        return;
      }

      // Fast typing and paste deliver several characters in one event
      const printable = !key.ctrl && !key.meta && input ? input.replace(/[\x00-\x1f\x7f]/g, '') : '';
      if (printable) {
        setQuery(prev => prev + printable);
        setSelectedIndex(0);
      }
    }
  });

  // Расчёт окна пагинации из PAGE_SIZE элементов вокруг selectedIndex
  let start = 0;
  let end = filtered.length;

  if (filtered.length > PAGE_SIZE) {
    start = Math.max(0, selectedIndex - Math.floor(PAGE_SIZE / 2));
    end = start + PAGE_SIZE;
    if (end > filtered.length) {
      end = filtered.length;
      start = Math.max(0, end - PAGE_SIZE);
    }
  }

  const visibleItems = filtered.slice(start, end);
  const remainingAbove = start;
  const remainingBelow = filtered.length - end;

  const hasDisabled = items.some(it => it.disabled);
  const hintLine = `↑↓ выбор · Enter · Esc — отмена${searchable ? ' · ввод — поиск' : ''}${hasDisabled ? ' · серые недоступны' : ''}`;

  return h(
    Box,
    {
      borderStyle: 'round',
      borderColor: t.border,
      paddingX: 1,
      flexDirection: 'column',
      width: '100%'
    },
    h(Text, { bold: true, color: t.accent }, title),
    searchable
      ? h(
          Box,
          { marginTop: 1, marginBottom: 1, flexDirection: 'row' },
          h(Text, { color: t.accent }, '🔍 '),
          h(Text, { color: t.text }, query),
          h(Text, { color: t.accent }, '█')
        )
      : null,
    remainingAbove > 0
      ? h(Text, { color: t.subtle, dimColor: true }, `  … ещё ${remainingAbove}`)
      : null,
    visibleItems.length === 0
      ? h(Text, { color: t.subtle, dimColor: true }, '  (нет совпадений)')
      : visibleItems.map((item, i) => {
          const realIndex = start + i;
          const isSelected = realIndex === selectedIndex;
          const cursor = isSelected
            ? h(Text, { color: t.accent }, '❯ ')
            : h(Text, null, '  ');
          const check = item.current
            ? h(Text, { color: t.success }, '✓ ')
            : h(Text, null, '  ');
          const groupPrefix = item.group
            ? h(Text, { color: t.subtle, dimColor: true }, `${item.group} · `)
            : null;
          const label = item.disabled
            ? h(Text, { color: t.faint, bold: isSelected }, item.label)
            : h(Text, { bold: isSelected, color: isSelected ? t.accent : t.text }, item.label);
          const hint = item.hint
            ? h(Text, { color: item.disabled ? t.border : t.subtle, dimColor: true }, `  ${item.hint}`)
            : null;
          let reason = null;
          if (item.disabled && item.reason) {
            reason = h(Text, { color: t.faint }, `  · ${item.reason}`);
          } else if (item.busy && !item.disabled && item.reason) {
            reason = h(Text, { color: t.warning }, `  · ${item.reason}`);
          }

          // One Text with nested parts so a long row is cut with "…" instead of wrapping
          return h(
            Text,
            { key: `${item.label}-${realIndex}`, wrap: 'truncate-end' },
            cursor,
            check,
            groupPrefix,
            label,
            hint,
            reason
          );
        }),
    remainingBelow > 0
      ? h(Text, { color: t.subtle, dimColor: true }, `  … ещё ${remainingBelow}`)
      : null,
    renderPreview && filtered[selectedIndex]
      ? h(
          Box,
          { marginTop: 1, flexDirection: 'column' },
          renderPreview(filtered[selectedIndex].value)
        )
      : null,
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: t.subtle, dimColor: true }, hintLine)
    )
  );
}
