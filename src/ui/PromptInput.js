/**
 * @fileoverview Компонент многострочного ввода с переносом по словам, ограничением высоты и прокруткой
 */

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import { wrapInput, cursorPosition, visibleRange } from './wrapInput.js';

const h = React.createElement;

/**
 * Проверяет, образуют ли два UTF-16 символа суррогатную пару.
 *
 * @param {string} str - Строка
 * @param {number} index - Индекс первого символа пары
 * @returns {boolean}
 */
function isSurrogatePair(str, index) {
  const hi = str.charCodeAt(index);
  const lo = str.charCodeAt(index + 1);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}

/**
 * Возвращает полный символ (кодовую точку) по индексу с сохранением суррогатных пар.
 *
 * @param {string} str - Строка
 * @param {number} index - Индекс символа
 * @returns {string} Символ (длиной 1 или 2 UTF-16 единицы)
 */
function getCodePointAt(str, index) {
  if (index >= str.length) return '';
  if (index + 1 < str.length && isSurrogatePair(str, index)) {
    return str.slice(index, index + 2);
  }
  return str[index];
}

/**
 * Компонент PromptInput заменяет ink-text-input в поле ввода чата.
 * Поддерживает многострочный перенос по словам, ограничение высоты maxLines
 * и прокрутку с индикаторами скрытых строк.
 *
 * @param {object} props
 * @param {string} [props.value=''] - Текущий текст ввода
 * @param {(val: string) => void} [props.onChange] - Колбэк изменения текста
 * @param {(val: string) => void} [props.onSubmit] - Колбэк отправки (Enter)
 * @param {string} [props.placeholder=''] - Текст-заполнитель
 * @param {boolean} [props.focus=true] - Активен ли фокус ввода
 * @param {boolean} [props.showCursor=true] - Показывать ли курсор
 * @param {number} [props.width=80] - Доступная ширина в колонках
 * @param {number} [props.maxLines=10] - Максимальная высота поля в строках
 * @returns {React.ReactElement}
 */
export function PromptInput({
  value = '',
  onChange,
  onSubmit,
  placeholder = '',
  focus = true,
  showCursor = true,
  width = 80,
  maxLines = 10
}) {
  const t = theme();
  const [cursorOffset, setCursorOffset] = useState(() => (value || '').length);
  const prevStartRef = useRef(0);

  useEffect(() => {
    const len = (value || '').length;
    if (cursorOffset > len) {
      setCursorOffset(len);
    }
  }, [value, cursorOffset]);

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === 'c') ||
        key.tab ||
        (key.shift && key.tab) ||
        key.escape
      ) {
        return;
      }

      if (key.return) {
        if (typeof onSubmit === 'function') {
          onSubmit(value);
        }
        return;
      }

      let nextOffset = cursorOffset;
      let nextValue = value || '';

      if (key.leftArrow) {
        if (showCursor && nextOffset > 0) {
          const step = nextOffset >= 2 && isSurrogatePair(nextValue, nextOffset - 2) ? 2 : 1;
          nextOffset -= step;
        }
      } else if (key.rightArrow) {
        if (showCursor && nextOffset < nextValue.length) {
          const step = nextOffset + 1 < nextValue.length && isSurrogatePair(nextValue, nextOffset) ? 2 : 1;
          nextOffset += step;
        }
      } else if (key.backspace || key.delete) {
        if (nextOffset > 0) {
          const step = nextOffset >= 2 && isSurrogatePair(nextValue, nextOffset - 2) ? 2 : 1;
          nextValue = nextValue.slice(0, nextOffset - step) + nextValue.slice(nextOffset);
          nextOffset -= step;
        }
      } else if (input) {
        nextValue = nextValue.slice(0, nextOffset) + input + nextValue.slice(nextOffset);
        nextOffset += input.length;
      }

      if (nextOffset < 0) nextOffset = 0;
      if (nextOffset > nextValue.length) nextOffset = nextValue.length;

      setCursorOffset(nextOffset);
      if (nextValue !== value && typeof onChange === 'function') {
        onChange(nextValue);
      }
    },
    { isActive: focus }
  );

  if (!value || value.length === 0) {
    let content = null;
    if (placeholder && placeholder.length > 0) {
      if (showCursor && focus) {
        const firstChar = getCodePointAt(placeholder, 0);
        const rest = placeholder.slice(firstChar.length);
        content = [
          h(Text, { key: 'cur', inverse: true }, firstChar),
          h(Text, { key: 'rest' }, rest)
        ];
      } else {
        content = placeholder;
      }
    } else if (showCursor && focus) {
      content = h(Text, { key: 'cur', inverse: true }, ' ');
    } else {
      content = '';
    }

    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { wrap: 'truncate-end', color: t.muted }, content)
    );
  }

  const lines = wrapInput(value, width);
  const cursorPos = cursorPosition(lines, cursorOffset, width, value);
  const isVirtual = cursorPos.line === lines.length;
  const totalLines = isVirtual ? lines.length + 1 : lines.length;
  const start = visibleRange(totalLines, cursorPos.line, maxLines, prevStartRef.current);
  prevStartRef.current = start;

  const count = Math.min(maxLines, totalLines - start);
  const linesAbove = start > 0 ? start : 0;
  const linesBelow = totalLines > start + count ? totalLines - (start + count) : 0;

  const rows = [];
  for (let i = 0; i < count; i++) {
    const lineIdx = start + i;

    // Подсказка о скрытых строках сверху
    if (i === 0 && linesAbove > 0 && lineIdx !== cursorPos.line) {
      rows.push(
        h(
          Text,
          { key: 'hint-above', wrap: 'truncate-end', color: t.muted },
          `↑ ещё ${linesAbove} стр.`
        )
      );
      continue;
    }

    // Подсказка о скрытых строках снизу
    if (i === count - 1 && linesBelow > 0 && lineIdx !== cursorPos.line) {
      rows.push(
        h(
          Text,
          { key: 'hint-below', wrap: 'truncate-end', color: t.muted },
          `↓ ещё ${linesBelow} стр.`
        )
      );
      continue;
    }

    const isCursorLine = lineIdx === cursorPos.line && showCursor && focus;

    if (lineIdx === lines.length) {
      rows.push(
        h(
          Text,
          { key: `line-${lineIdx}`, wrap: 'truncate-end' },
          isCursorLine ? h(Text, { inverse: true }, ' ') : ''
        )
      );
      continue;
    }

    const range = lines[lineIdx];
    let lineText = value.slice(range.start, range.end);
    const hasNewline = /\r?\n$/.test(lineText);
    lineText = lineText.replace(/\r?\n$/, '');

    if (!isCursorLine) {
      rows.push(h(Text, { key: `line-${lineIdx}`, wrap: 'truncate-end' }, lineText));
      continue;
    }

    const effEnd = hasNewline
      ? range.end - (range.end > 1 && value[range.end - 2] === '\r' ? 2 : 1)
      : range.end;

    if (cursorOffset >= effEnd) {
      rows.push(
        h(
          Text,
          { key: `line-${lineIdx}`, wrap: 'truncate-end' },
          lineText,
          h(Text, { inverse: true }, ' ')
        )
      );
    } else {
      const localOffset = Math.max(0, cursorOffset - range.start);
      const char = getCodePointAt(lineText, localOffset);
      const before = lineText.slice(0, localOffset);
      const after = lineText.slice(localOffset + char.length);
      rows.push(
        h(
          Text,
          { key: `line-${lineIdx}`, wrap: 'truncate-end' },
          before,
          h(Text, { inverse: true }, char),
          after
        )
      );
    }
  }

  return h(Box, { flexDirection: 'column' }, rows);
}
