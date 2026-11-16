/**
 * @fileoverview Чистый модуль переноса строк ввода, расчёта позиции курсора и видимого диапазона
 */

/**
 * Проверяет, является ли кодовая точка широким символом (2 колонки в терминале).
 * Диапазоны: U+1100–U+115F, U+2E80–U+A4CF, U+AC00–U+D7A3, U+F900–U+FAFF,
 * U+FE30–U+FE4F, U+FF00–U+FF60, U+FFE0–U+FFE6, U+1F300–U+1FAFF.
 *
 * @param {number} cp - Кодовая точка Unicode
 * @returns {boolean}
 */
export function isWideCodePoint(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

/**
 * Вычисляет экранную ширину строки в терминале с учётом широких символов.
 * Символы перевода строки \n и \r считаются нулевой ширины (не отображаются).
 *
 * @param {string} str - Строка для измерения
 * @returns {number} Экранная ширина в колонках
 */
export function stringDisplayWidth(str) {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13) {
      continue;
    }
    width += isWideCodePoint(cp) ? 2 : 1;
  }
  return width;
}

/**
 * Разбивает значение на диапазоны строк { start, end } с переносом по словам.
 * Диапазоны непрерывны и при объединении дают исходное значение.
 * Резервирует последнюю колонку: непробельные символы помещаются только при
 * lineWidth + w <= width - 1, а пробел может занимать последнюю колонку (lineWidth + 1 <= width).
 * Если символ в точке переноса — пробел, он включается в конец текущей строки.
 * Иначе перенос выполняется после последнего поместившегося пробела; иначе слово переносится жестко.
 * Экранная ширина каждой строки <= width. При width = 1 бюджет делает прогресс (минимум 1 символ).
 * Символ '\n' принудительно завершает строку и принадлежит ей.
 *
 * @param {string} value - Исходный текст
 * @param {number} width - Доступная ширина в колонках
 * @returns {Array<{ start: number, end: number }>} Массив диапазонов
 */
export function wrapInput(value, width) {
  if (typeof value !== 'string' || value.length === 0) {
    return [{ start: 0, end: 0 }];
  }

  const targetWidth = Math.max(1, width);
  const lines = [];
  const len = value.length;
  let lineStart = 0;

  while (lineStart < len) {
    let curWidth = 0;
    let lastFitIndex = lineStart;
    let lastSpaceBreak = -1;
    let i = lineStart;
    let newlineBreak = -1;

    while (i < len) {
      const code = value.charCodeAt(i);
      if (code === 10) {
        newlineBreak = i + 1;
        break;
      }
      if (code === 13) {
        if (i + 1 < len && value.charCodeAt(i + 1) === 10) {
          newlineBreak = i + 2;
        } else {
          newlineBreak = i + 1;
        }
        break;
      }

      const cp = value.codePointAt(i);
      const chLen = cp > 0xffff ? 2 : 1;
      const w = isWideCodePoint(cp) ? 2 : 1;
      const isSpace = code === 32;

      const fits = curWidth === 0
        ? true
        : isSpace
          ? curWidth + 1 <= targetWidth
          : curWidth + w <= targetWidth - 1;

      if (fits) {
        curWidth += w;
        i += chLen;
        lastFitIndex = i;
        if (isSpace) {
          lastSpaceBreak = i;
        }
      } else {
        break;
      }
    }

    if (newlineBreak !== -1) {
      lines.push({ start: lineStart, end: newlineBreak });
      lineStart = newlineBreak;
      continue;
    }

    if (i >= len) {
      lines.push({ start: lineStart, end: len });
      lineStart = len;
      break;
    }

    if (i < len && value.charCodeAt(i) === 32 && curWidth + 1 <= targetWidth) {
      lines.push({ start: lineStart, end: i + 1 });
      lineStart = i + 1;
    } else if (lastSpaceBreak > lineStart) {
      lines.push({ start: lineStart, end: lastSpaceBreak });
      lineStart = lastSpaceBreak;
    } else {
      const fallbackEnd = i + (value.codePointAt(i) > 0xffff ? 2 : 1);
      const breakAt = lastFitIndex > lineStart ? lastFitIndex : fallbackEnd;
      lines.push({ start: lineStart, end: breakAt });
      lineStart = breakAt;
    }
  }

  if (value.endsWith('\n') || value.endsWith('\r')) {
    lines.push({ start: len, end: len });
  }

  return lines;
}

/**
 * Вычисляет позицию курсора { line, col }.
 * Если курсор в самом конце и ширина последней строки равна width,
 * возвращается новая пустая виртуальная строка (line = lines.length).
 *
 * @param {Array<{ start: number, end: number }>} lines - Диапазоны строк
 * @param {number} cursorOffset - Смещение курсора в символах
 * @param {number} width - Доступная ширина в колонках
 * @param {string} value - Исходный текст
 * @returns {{ line: number, col: number }}
 */
export function cursorPosition(lines, cursorOffset, width, value) {
  if (!lines || lines.length === 0) {
    return { line: 0, col: 0 };
  }

  const val = typeof value === 'string' ? value : '';
  const clampedOffset = Math.max(0, Math.min(cursorOffset, val.length));

  const lastLine = lines[lines.length - 1];
  const lastLineText = val.slice(lastLine.start, lastLine.end).replace(/\r?\n$/, '');
  const lastLineWidth = stringDisplayWidth(lastLineText);

  if (clampedOffset === lastLine.end && lastLineWidth === width) {
    return { line: lines.length, col: 0 };
  }

  let targetLine = lines.length - 1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (clampedOffset < lines[i].end) {
      targetLine = i;
      break;
    }
  }

  const range = lines[targetLine];
  const prefix = val.slice(range.start, Math.min(clampedOffset, range.end)).replace(/\r?\n$/, '');
  const col = stringDisplayWidth(prefix);

  return { line: targetLine, col };
}

/**
 * Вычисляет индекс первой видимой строки при прокрутке окна ввода.
 * Сохраняет prevStart, если курсор попадает в диапазон [prevStart, prevStart + maxLines).
 * Иначе минимально прокручивает окно, чтобы строка курсора была видна.
 *
 * @param {number} totalLines - Общее количество строк
 * @param {number} cursorLine - Индекс строки, на которой находится курсор
 * @param {number} maxLines - Максимальная высота окна в строках
 * @param {number} [prevStart=0] - Предыдущий индекс первой видимой строки
 * @returns {number} Индекс первой видимой строки
 */
export function visibleRange(totalLines, cursorLine, maxLines, prevStart = 0) {
  if (totalLines <= maxLines) {
    return 0;
  }

  const maxStart = Math.max(0, totalLines - maxLines);
  let start = typeof prevStart === 'number' ? Math.max(0, Math.min(prevStart, maxStart)) : 0;

  if (cursorLine >= start && cursorLine < start + maxLines) {
    return start;
  }

  if (cursorLine < start) {
    start = cursorLine;
  } else {
    start = cursorLine - maxLines + 1;
  }

  return Math.max(0, Math.min(start, maxStart));
}
