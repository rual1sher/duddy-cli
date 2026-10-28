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
      const lines = item.lines || [];
      if (lines.length === 0) {
        return h(
          Box,
          { key: `assistant-${index}`, marginTop: 1, flexDirection: 'row' },
          h(Text, { color: '#38bdf8' }, '⏺ ')
        );
      }
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
      const dotColor = item.ok ? '#10b981' : '#ef4444';
      const filteredLogs = (item.logs || []).filter(
        l => l && (l.level === 'error' || l.level === 'warn')
      );
      return h(
        Box,
        { key: `tool-${index}`, flexDirection: 'column' },
        h(
          Box,
          { flexDirection: 'row' },
          h(Text, { color: dotColor }, '⏺ '),
          h(Text, { bold: true, color: '#f8fafc' }, item.name),
          item.target ? h(Text, { color: '#94a3b8' }, `(${item.target})`) : null
        ),
        item.summary
          ? h(Text, { color: '#94a3b8', dimColor: true }, `  ⎿  ${item.summary}`)
          : null,
        filteredLogs.map((log, i) =>
          h(
            Text,
            { key: i, color: log.level === 'error' ? '#ef4444' : '#f59e0b' },
            `    ${log.text}`
          )
        )
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

    case 'done':
      return h(
        Text,
        { key: `done-${index}`, color: '#94a3b8', dimColor: true },
        `  ${item.text}`
      );

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
