/**
 * @fileoverview Форматирование вызовов и результатов инструментов в стиле Claude Code
 */

/**
 * Склонение существительных с числительными в русском языке
 *
 * @param {number} n - Число
 * @param {string} one - Форма для 1 (например, "строка", "элемент")
 * @param {string} few - Форма для 2-4 (например, "строки", "элемента")
 * @param {string} many - Форма для остальных (например, "строк", "элементов")
 * @returns {string} Число и правильная форма слова через пробел
 */
export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = many;
  if (mod10 === 1 && mod100 !== 11) {
    word = one;
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    word = few;
  }
  return `${n} ${word}`;
}

const START_TITLES = {
  read_file: 'Читает',
  list_dir: 'Смотрит папку',
  create_file: 'Записывает',
  create_folder: 'Создаёт папку',
  edit_file: 'Изменяет',
  delete_file: 'Удаляет',
  delete_folder: 'Удаляет папку'
};

/**
 * Описание начала выполнения инструмента (для live-отображения)
 *
 * @param {string} name - Имя инструмента
 * @param {object} [args] - Аргументы вызова инструмента
 * @returns {{ title: string, target: string }}
 */
export function describeToolStart(name, args) {
  const title = START_TITLES[name] || name || '';
  const target = name === 'list_dir' ? (args?.path?.trim?.() || '.') : (args?.path ?? '');
  return { title, target };
}

/**
 * Разделение текста на строки с нормализацией переводов строк.
 * Если текст заканчивается переводом строки, последний пустой элемент отбрасывается.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function toLines(text) {
  if (!text) return [];
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

/**
 * Описание завершения выполнения инструмента
 *
 * @param {string} name - Имя инструмента
 * @param {object|null} args - Аргументы вызова инструмента (может быть null)
 * @param {string} resultText - Текстовый результат инструмента
 * @param {boolean} ok - Флаг успешности выполнения
 * @returns {{ title: string, target: string, summary: string, diff: Array<object>, change: string|null }}
 */
export function describeToolResult(name, args, resultText, ok) {
  const target = name === 'list_dir' ? (args?.path?.trim?.() || '.') : (args?.path ?? '');
  const rawText = String(resultText ?? '');

  if (!ok) {
    const start = describeToolStart(name, args);
    const firstLine = rawText.split('\n')[0] || '';
    const cleaned = firstLine.replace(/^Ошибка:\s*/, '');
    return {
      title: start.title,
      target,
      summary: cleaned.slice(0, 160),
      diff: [],
      change: null
    };
  }

  switch (name) {
    case 'read_file': {
      const lines = toLines(rawText);
      let summary = plural(lines.length, 'строка', 'строки', 'строк');
      if (rawText.includes('...[Обрезано')) {
        summary += ' (обрезано)';
      }
      return {
        title: 'Прочитан',
        target,
        summary,
        diff: [],
        change: null
      };
    }

    case 'list_dir': {
      const firstLine = rawText.split('\n')[0] || '';
      const match = firstLine.match(/\((\d+)\s+элемент/) || firstLine.match(/\((\d+)/);
      const count = match ? parseInt(match[1], 10) : 0;
      return {
        title: 'Папка',
        target,
        summary: plural(count, 'элемент', 'элемента', 'элементов'),
        diff: [],
        change: null
      };
    }

    case 'create_file': {
      const lower = rawText.toLowerCase();
      const isOverwrite = lower.includes('перезаписан');
      const title = isOverwrite ? 'Перезаписан' : 'Создан';
      const change = isOverwrite ? 'modified' : 'created';

      const content = args?.content ?? '';
      const lines = toLines(content);
      const summary = plural(lines.length, 'строка', 'строки', 'строк');

      const diff = [];
      const maxPreview = 6;
      for (let i = 0; i < Math.min(lines.length, maxPreview); i++) {
        diff.push({ kind: 'add', text: lines[i] });
      }
      if (lines.length > maxPreview) {
        const remaining = lines.length - maxPreview;
        diff.push({ kind: 'more', text: `… ещё ${plural(remaining, 'строка', 'строки', 'строк')}` });
      }

      return {
        title,
        target,
        summary,
        diff,
        change
      };
    }

    case 'edit_file': {
      const oldLines = toLines(args?.old_content ?? '');
      const newLines = toLines(args?.new_content ?? '');

      let start = 0;
      while (
        start < oldLines.length &&
        start < newLines.length &&
        oldLines[start] === newLines[start]
      ) {
        start++;
      }

      let oldEnd = oldLines.length - 1;
      let newEnd = newLines.length - 1;
      while (
        oldEnd >= start &&
        newEnd >= start &&
        oldLines[oldEnd] === newLines[newEnd]
      ) {
        oldEnd--;
        newEnd--;
      }

      const removed = oldLines.slice(start, oldEnd + 1);
      const added = newLines.slice(start, newEnd + 1);
      const A = added.length;
      const R = removed.length;
      const summary = `+${A} −${R} строк`;

      const allDiff = [
        ...removed.map(text => ({ kind: 'del', text })),
        ...added.map(text => ({ kind: 'add', text }))
      ];

      const maxDiff = 10;
      let diff;
      if (allDiff.length <= maxDiff) {
        diff = allDiff;
      } else {
        const remaining = allDiff.length - maxDiff;
        diff = [
          ...allDiff.slice(0, maxDiff),
          { kind: 'more', text: `… ещё ${plural(remaining, 'строка', 'строки', 'строк')}` }
        ];
      }

      return {
        title: 'Изменён',
        target,
        summary,
        diff,
        change: 'modified'
      };
    }

    case 'create_folder': {
      const summary = rawText.includes('уже существует') ? 'уже существует' : '';
      return {
        title: 'Создана папка',
        target,
        summary,
        diff: [],
        change: null
      };
    }

    case 'delete_file':
      return {
        title: 'Удалён',
        target,
        summary: '',
        diff: [],
        change: 'deleted'
      };

    case 'delete_folder':
      return {
        title: 'Удалена папка',
        target,
        summary: '',
        diff: [],
        change: 'deleted'
      };

    default: {
      const firstLine = rawText.split('\n')[0] || '';
      return {
        title: name,
        target,
        summary: firstLine.slice(0, 120),
        diff: [],
        change: null
      };
    }
  }
}
