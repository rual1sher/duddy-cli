/**
 * @fileoverview Разметка активных инструментов и стриминга живого вывода ответа модели
 */

import React from 'react';
import { Box, Text } from 'ink';
import { renderMarkdown } from '../render/formatter.js';
import { theme } from '../render/theme.js';

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
  const t = theme();
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
              h(Box, { flexShrink: 0 }, h(Text, { color: t.accent }, '⏺ ')),
              h(Box, { flexShrink: 0 }, h(Text, { bold: true, color: t.text }, tool.display?.title || tool.name)),
              tool.target
                ? h(Text, { color: t.muted, wrap: 'truncate-middle' }, ` ${tool.target}`)
                : null,
              h(Box, { flexShrink: 0 }, h(Text, { color: t.muted }, '…'))
            ),
            filteredLogs.map((log, i) =>
              h(
                Text,
                { key: i, color: log.level === 'error' ? t.error : t.warning },
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
              ? h(Text, { color: t.accent }, '⏺ ')
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
