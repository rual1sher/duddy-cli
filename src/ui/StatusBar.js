/**
 * @fileoverview Строка состояния (StatusBar) под полем ввода
 */

import React from 'react';
import { Box, Text } from 'ink';
import { MODE_INFO } from '../agent/modes.js';
import { theme } from '../render/theme.js';

const h = React.createElement;

/**
 * Компонент строки состояния
 *
 * @param {object} props
 * @param {'idle'|'working'} props.status
 * @param {object} props.session
 * @param {number} [props.queuedCount=0]
 * @param {boolean} [props.waitingForUser=false]
 * @param {string} [props.mode='default']
 * @returns {React.ReactElement}
 */
export function StatusBar({ status, session, queuedCount = 0, waitingForUser = false, mode = 'default' }) {
  const t = theme();

  if (status === 'working') {
    const routedModel = session?.lastRoutedModel;
    const model = session?.model || 'model';
    const label = routedModel && routedModel !== model ? `${model} → ${routedModel}` : model;

    return h(
      Box,
      { paddingX: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { color: t.subtle, dimColor: true }, label),
        mode !== 'default' && MODE_INFO[mode]?.label
          ? h(Text, { color: t[MODE_INFO[mode].color] || MODE_INFO[mode].color }, ` · ${MODE_INFO[mode].label}`)
          : null,
        queuedCount > 0
          ? h(Text, { color: t.subtle, dimColor: true }, ` · в очереди: ${queuedCount}`)
          : null,
        h(Text, { color: t.subtle, dimColor: true }, ' · Esc — прервать')
      )
    );
  }

  // Idle state
  const model = session?.model || 'model';

  return h(
    Box,
    { paddingX: 1 },
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { bold: true, color: t.accent }, model),
      mode !== 'default' && MODE_INFO[mode]?.label
        ? h(Text, { color: t[MODE_INFO[mode].color] || MODE_INFO[mode].color }, ` · ${MODE_INFO[mode].label}`)
        : null
    )
  );
}
