/**
 * @fileoverview Разметка активных инструментов и стриминга живого вывода ответа модели
 */

import React from 'react';
import { Box, Text } from 'ink';
import { renderMarkdown } from '../formatter.js';

const h = React.createElement;

/**
 * Отрисовывает блок выполняемых инструментов и стриминг ответа модели
 *
 * @param {object} props
 * @param {Array} props.liveTools - Список выполняемых в данный момент инструментов
 * @param {string} props.liveText - Накапливаемый текст потокового ответа
 * @returns {React.ReactElement|null}
 */
export function LiveOutput({ liveTools, liveText }) {
  const liveElements = [];

  if (liveTools && liveTools.length > 0) {
    liveElements.push(
      h(
        Box,
        { key: 'live-tools', flexDirection: 'column' },
        liveTools.map(tool => {
          const filteredLogs = (tool.logs || []).filter(
            l => l && (l.level === 'error' || l.level === 'warn')
          );
          return h(
            Box,
            { key: tool.id, flexDirection: 'column' },
            h(
              Box,
              { flexDirection: 'row' },
              h(Text, { color: '#38bdf8' }, '⏺ '),
              h(Text, { bold: true, color: '#f8fafc' }, tool.display?.title || tool.name),
              tool.target ? h(Text, { color: '#94a3b8' }, ` ${tool.target}`) : null,
              h(Text, { color: '#94a3b8' }, '…')
            ),
            filteredLogs.map((log, i) =>
              h(
                Text,
                { key: i, color: log.level === 'error' ? '#ef4444' : '#f59e0b' },
                `    ${log.text}`
              )
            )
          );
        })
      )
    );
  }

  if (liveText && liveText.trim()) {
    const liveLines = renderMarkdown(liveText);
    liveElements.push(
      h(
        Box,
        { key: 'live-text', marginTop: 1, flexDirection: 'column' },
        liveLines.map((line, i) =>
          h(
            Box,
            { key: i, flexDirection: 'row' },
            i === 0
              ? h(Text, { color: '#38bdf8' }, '⏺ ')
              : h(Text, null, '  '),
            h(Text, null, line)
          )
        )
      )
    );
  }

  if (liveElements.length === 0) {
    return null;
  }

  return h(Box, { flexDirection: 'column' }, liveElements);
}
