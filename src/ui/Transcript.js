/**
 * @fileoverview Компонент истории диалога (Transcript) на базе Ink Static
 */

import React from 'react';
import { Box, Text, Static } from 'ink';
import { bannerLines } from '../banner.js';

const h = React.createElement;

/**
 * Рендерит отдельный элемент истории диалога
 *
 * @param {object} item
 * @param {number} index
 * @param {object} session
 * @returns {React.ReactElement}
 */
function renderTranscriptItem(item, index, session) {
  switch (item.type) {
    case 'banner': {
      const lines = bannerLines({
        model: session?.model,
        provider: session?.provider,
        hasKey: Boolean(session?.apiKey)
      });
      return h(
        Box,
        { key: `banner-${index}`, flexDirection: 'column' },
        lines.map((line, i) => h(Text, { key: i }, line || ' '))
      );
    }

    case 'user':
      return h(
        Box,
        { key: `user-${index}`, marginTop: 1, flexDirection: 'row' },
        h(Text, { color: '#64748b' }, '> '),
        h(Text, { color: '#f8fafc' }, item.text)
      );

    case 'assistant': {
      const rawLines = item.lines || [];
      const isBlank = (line) =>
        !line || line.replace(/\x1b\[[0-9;]*m/g, '').trim().length === 0;

      let start = 0;
      while (start < rawLines.length && isBlank(rawLines[start])) {
        start++;
      }
      let end = rawLines.length - 1;
      while (end >= start && isBlank(rawLines[end])) {
        end--;
      }

      if (start > end) {
        return null;
      }

      const lines = rawLines.slice(start, end + 1);
      return h(
        Box,
        { key: `assistant-${index}`, marginTop: 1, flexDirection: 'column' },
        lines.map((line, i) =>
          h(
            Box,
            { key: i, flexDirection: 'row' },
            i === 0
              ? h(Text, { color: '#38bdf8' }, '⏺ ')
              : h(Text, null, '  '),
            h(Text, null, line)
          )
        )
      );
    }

    case 'tool': {
      const dotColor = !item.ok ? '#ef4444' : item.change ? '#10b981' : '#64748b';
      const hasTitle = Boolean(item.title);
      const headerChildren = [
        h(Text, { color: dotColor }, '⏺ '),
        h(Text, { bold: true, color: '#f8fafc' }, item.title || item.name)
      ];

      if (item.target) {
        if (hasTitle) {
          headerChildren.push(h(Text, { color: '#94a3b8' }, ` ${item.target}`));
        } else {
          headerChildren.push(h(Text, { color: '#94a3b8' }, `(${item.target})`));
        }
      }

      const summaryColor = item.ok ? '#94a3b8' : '#ef4444';
      const summaryElement = item.summary
        ? h(Text, { color: summaryColor, dimColor: Boolean(item.ok) }, `  ⎿  ${item.summary}`)
        : null;

      const diffElements = (item.diff || []).map((d, i) => {
        let prefix = '';
        let color = '#94a3b8';
        let isDim = false;

        if (d.kind === 'add') {
          prefix = '+ ';
          color = '#10b981';
        } else if (d.kind === 'del') {
          prefix = '- ';
          color = '#ef4444';
        } else if (d.kind === 'more') {
          prefix = '';
          color = '#94a3b8';
          isDim = true;
        }

        const rawLine = `${prefix}${d.text || ''}`;
        const truncated = rawLine.slice(0, 140);

        return h(
          Text,
          {
            key: `diff-${i}`,
            color,
            dimColor: isDim,
            wrap: 'truncate-end'
          },
          `     ${truncated}`
        );
      });

      const summaryText = (item.summary || '').trim();
      const filteredLogs = (item.logs || []).filter(l => {
        if (!l || (l.level !== 'error' && l.level !== 'warn')) return false;
        if (!summaryText) return true;
        const rawLog = (l.text || '').replace(/^✖\s*/, '').trim();
        const rawLogNoErr = rawLog.replace(/^Ошибка:\s*/, '').trim();
        if (rawLog === summaryText || rawLogNoErr === summaryText) {
          return false;
        }
        return true;
      });

      const logElements = filteredLogs.map((log, i) =>
        h(
          Text,
          { key: `log-${i}`, color: log.level === 'error' ? '#ef4444' : '#f59e0b' },
          `    ${log.text}`
        )
      );

      return h(
        Box,
        { key: `tool-${index}`, flexDirection: 'column' },
        h(Box, { flexDirection: 'row' }, ...headerChildren),
        summaryElement,
        ...diffElements,
        ...logElements
      );
    }

    case 'note': {
      let color = '#94a3b8';
      let isDim = false;
      if (item.level === 'success') {
        color = '#10b981';
      } else if (item.level === 'warn') {
        color = '#f59e0b';
      } else if (item.level === 'error') {
        color = '#ef4444';
      } else {
        isDim = true;
      }
      return h(
        Box,
        { key: `note-${index}`, flexDirection: 'column' },
        h(Text, { color, dimColor: isDim }, item.text),
        item.hint
          ? h(Text, { color: '#64748b', dimColor: true }, `  ↳ ${item.hint}`)
          : null
      );
    }

    case 'lines':
      return h(
        Box,
        { key: `lines-${index}`, flexDirection: 'column' },
        (item.lines || []).map((line, i) => h(Text, { key: i }, line || ' '))
      );

    case 'done': {
      const hasChanges =
        item.changes &&
        (item.changes.created?.length > 0 ||
          item.changes.modified?.length > 0 ||
          item.changes.deleted?.length > 0);

      const doneText = h(
        Text,
        { key: 'text', color: '#94a3b8', dimColor: true },
        `  ${item.text}`
      );

      if (!hasChanges) {
        return h(
          Text,
          { key: `done-${index}`, color: '#94a3b8', dimColor: true },
          `  ${item.text}`
        );
      }

      const changeElements = [];
      if (item.changes.created?.length > 0) {
        changeElements.push(
          h(
            Text,
            { key: 'created', color: '#10b981', dimColor: true },
            `  Создано: ${item.changes.created.join(', ')}`
          )
        );
      }
      if (item.changes.modified?.length > 0) {
        changeElements.push(
          h(
            Text,
            { key: 'modified', color: '#f59e0b', dimColor: true },
            `  Изменено: ${item.changes.modified.join(', ')}`
          )
        );
      }
      if (item.changes.deleted?.length > 0) {
        changeElements.push(
          h(
            Text,
            { key: 'deleted', color: '#ef4444', dimColor: true },
            `  Удалено: ${item.changes.deleted.join(', ')}`
          )
        );
      }

      return h(
        Box,
        { key: `done-${index}`, flexDirection: 'column' },
        doneText,
        ...changeElements
      );
    }

    default:
      return h(Text, { key: index }, '');
  }
}

/**
 * Компонент истории диалога
 *
 * @param {object} props
 * @param {Array<object>} props.items - Элементы истории
 * @param {object} props.session - Текущая сессия Duddy
 * @param {number} props.staticKey - Ключ для сброса и полной перерисовки
 * @returns {React.ReactElement}
 */
export function Transcript({ items, session, staticKey }) {
  return h(
    Static,
    { key: staticKey, items },
    (item, index) => renderTranscriptItem(item, index, session)
  );
}
