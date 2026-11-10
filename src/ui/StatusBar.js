/**
 * @fileoverview Строка состояния (StatusBar) под полем ввода
 */

import React from 'react';
import { Box, Text, Spacer } from 'ink';
import { getProvider } from '../providers.js';
import { formatDuration } from '../formatter.js';
import { MODE_INFO } from '../modes.js';
import { theme } from '../theme.js';
import { useTicker } from './hooks/useTicker.js';
import { ringCells } from './WorkingIndicator.js';

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
  const { tick } = useTicker(status === 'working' && !waitingForUser, 150);

  if (status === 'working') {
    const routedModel = session?.lastRoutedModel;
    const model = session?.model || 'model';
    const label = routedModel && routedModel !== model ? `${model} → ${routedModel}` : model;

    const activeColor = waitingForUser ? t.warning : t.accent;
    const color = (level) => {
      if (level === 'head') return activeColor;
      if (level === 'trail1') return t.muted;
      if (level === 'trail2') return t.subtle;
      if (level === 'track') return t.border;
      return undefined;
    };

    const cells = ringCells(tick);

    return h(
      Box,
      { paddingX: 1, flexDirection: 'row' },
      h(
        Box,
        { marginRight: 1, flexShrink: 0 },
        h(
          Text,
          null,
          cells[0].map((cell, c) =>
            h(Text, { key: c, color: color(cell.top), backgroundColor: color(cell.bottom) }, '▀')
          )
        )
      ),
      h(
        Box,
        { flexShrink: 1 },
        h(
          Text,
          { wrap: 'truncate-end' },
          h(Text, { color: t.subtle, dimColor: true }, label),
          mode !== 'default' && MODE_INFO[mode]?.label
            ? h(Text, { color: t[MODE_INFO[mode].color] || MODE_INFO[mode].color }, ` · ${MODE_INFO[mode].label}`)
            : null,
          session?.autoSpeak
            ? h(Text, { color: t.warning || 'yellow' }, ' · 🔊')
            : null,
          queuedCount > 0
            ? h(Text, { color: t.subtle, dimColor: true }, ` · в очереди: ${queuedCount}`)
            : null,
          h(Text, { color: t.subtle, dimColor: true }, ' · Esc — прервать')
        )
      )
    );
  }

  // Idle state
  const provider = getProvider(session?.provider);
  const model = session?.model || 'model';
  const routedSuffix =
    session?.lastRoutedModel && session.lastRoutedModel !== model
      ? ` → ${session.lastRoutedModel}`
      : '';
  const effortSuffix =
    session?.reasoningEffort && session.reasoningEffort !== 'auto'
      ? ` · ${session.reasoningEffort}`
      : '';

  const rightParts = [];
  if (session?.lastTurnMs) {
    rightParts.push(h(Text, { key: 'turn', color: t.muted }, `⏱ ${formatDuration(session.lastTurnMs)}`));
  }

  if (session?.lastUsage?.total_tokens) {
    const total = session.lastUsage.total_tokens;
    const tokFormatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    rightParts.push(h(Text, { key: 'tok', color: t.success }, `${tokFormatted} tok`));

    if (session?.contextLength) {
      const remaining = Math.max(0, session.contextLength - total);
      let remFormatted;
      if (remaining >= 950_000) {
        remFormatted = `${Math.round(remaining / 1_000_000)}M`;
      } else if (remaining >= 1000) {
        remFormatted = `${Math.round(remaining / 1000)}k`;
      } else {
        remFormatted = `${remaining}`;
      }
      rightParts.push(
        h(Text, { key: 'rem', color: t.subtle, dimColor: true }, `осталось ${remFormatted}`)
      );
    }
  }

  return h(
    Box,
    { paddingX: 1, flexDirection: 'row' },
    h(
      Box,
      { flexShrink: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { bold: true, color: t.accent }, model),
        routedSuffix ? h(Text, { color: t.subtle }, routedSuffix) : null,
        h(Text, { color: t.subtle, dimColor: true }, ` · ${provider.title}`),
        effortSuffix ? h(Text, { color: t.subtle, dimColor: true }, effortSuffix) : null,
        mode !== 'default' && MODE_INFO[mode]?.label
          ? h(Text, { color: t[MODE_INFO[mode].color] || MODE_INFO[mode].color }, ` · ${MODE_INFO[mode].label}`)
          : null,
        session?.autoSpeak
          ? h(Text, { color: t.warning || 'yellow' }, ' · 🔊 voice')
          : null
      )
    ),
    h(Spacer, null),
    h(
      Box,
      { flexShrink: 1, marginLeft: 2 },
      h(
        Text,
        { wrap: 'truncate-end' },
        rightParts.length > 0
          ? rightParts.map((el, i) =>
              h(
                React.Fragment,
                { key: i },
                i > 0 ? h(Text, { color: t.subtle, dimColor: true }, ' · ') : null,
                el
              )
            )
          : h(Text, { color: t.subtle, dimColor: true }, 'новый диалог')
      )
    )
  );
}
