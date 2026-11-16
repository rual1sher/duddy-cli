/**
 * @fileoverview Описание и форматирование результатов выполнения инструментов
 */

import { plural, toolTarget, describeToolStart } from './toolDisplay.js';

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
  const target = toolTarget(name, args);
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

    case 'bash': {
      const lines = toLines(rawText);
      const shown = lines.slice(-6).map(text => ({ kind: 'more', text: text.slice(0, 160) }));
      return {
        title: 'Выполнена',
        target,
        summary: plural(lines.length, 'строка', 'строки', 'строк'),
        diff: shown,
        change: null
      };
    }

    case 'grep': {
      if (rawText.startsWith('Совпадений нет')) {
        return {
          title: 'Поиск',
          target,
          summary: 'нет совпадений',
          diff: [],
          change: null
        };
      }
      const lines = toLines(rawText).filter(l => l && !l.startsWith('...['));
      return {
        title: 'Поиск',
        target,
        summary: plural(lines.length, 'совпадение', 'совпадения', 'совпадений'),
        diff: [],
        change: null
      };
    }

    case 'glob': {
      if (rawText.startsWith('Файлов нет')) {
        return {
          title: 'Файлы',
          target,
          summary: 'нет файлов',
          diff: [],
          change: null
        };
      }
      const firstLine = rawText.split('\n')[0] || '';
      const match = firstLine.match(/Найдено файлов:\s*(\d+)/);
      const count = match ? parseInt(match[1], 10) : 0;
      return {
        title: 'Файлы',
        target,
        summary: count > 0 ? plural(count, 'файл', 'файла', 'файлов') : 'нет файлов',
        diff: [],
        change: null
      };
    }

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
