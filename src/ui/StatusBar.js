/**
 * @fileoverview Строка состояния (StatusBar) под полем ввода
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, Spacer } from 'ink';
import { getProvider } from '../providers.js';
import { formatDuration } from '../formatter.js';

const h = React.createElement;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Компонент строки состояния
 *
 * @param {object} props
 * @param {'idle'|'working'} props.status
 * @param {object} props.session
 * @param {string} props.phase
 * @param {number|null} props.startedAt
 * @param {() => number} [props.getLastActivity]
 * @param {number} [props.queuedCount=0]
 * @param {boolean} [props.waitingForUser=false]
 * @returns {React.ReactElement}
 */
export function StatusBar({ status, session, phase, startedAt, getLastActivity, queuedCount = 0, waitingForUser = false }) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== 'working') return;
    const timer = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % SPINNER_FRAMES.length);
      setNow(Date.now());
    }, 80);
    return () => clearInterval(timer);
  }, [status]);

  if (status === 'working') {
    const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
    const spinnerChar = SPINNER_FRAMES[frameIndex];

    let phaseName = 'Думает';
    if (waitingForUser) phaseName = 'Ждёт подтверждения';
    else if (phase === 'reasoning') phaseName = 'Рассуждает';
    else if (phase === 'tools') phaseName = 'Выполняет инструменты';

    const routedModel = session?.lastRoutedModel;
    const model = session?.model || 'model';
    const label = routedModel && routedModel !== model ? `${model} → ${routedModel}` : model;
    const isSlow = !waitingForUser && now - (getLastActivity?.() || startedAt || now) > 20000;

    return h(
      Box,
      { paddingX: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { color: '#38bdf8' }, `${spinnerChar} ${phaseName}… ${formatDuration(elapsed)}`),
        isSlow
          ? h(Text, { color: '#f59e0b' }, ' · долго: провайдер может быть перегружен')
          : null,
        h(Text, { color: '#64748b', dimColor: true }, ` · ${label}`),
        queuedCount > 0
          ? h(Text, { color: '#64748b', dimColor: true }, ` · в очереди: ${queuedCount}`)
          : null,
        h(Text, { color: '#64748b', dimColor: true }, ' · Esc — прервать')
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
    rightParts.push(h(Text, { key: 'turn', color: '#94a3b8' }, `⏱ ${formatDuration(session.lastTurnMs)}`));
  }

  if (session?.lastUsage?.total_tokens) {
    const total = session.lastUsage.total_tokens;
    const tokFormatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    rightParts.push(h(Text, { key: 'tok', color: '#10b981' }, `${tokFormatted} tok`));

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
        h(Text, { key: 'rem', color: '#64748b', dimColor: true }, `осталось ${remFormatted}`)
      );
    }
  }

  return h(
    Box,
    { paddingX: 1, flexDirection: 'row' },
    h(
      Box,
      { flexDirection: 'row' },
      h(Text, { bold: true, color: '#38bdf8' }, model),
      routedSuffix ? h(Text, { color: '#64748b' }, routedSuffix) : null,
      h(Text, { color: '#64748b', dimColor: true }, ` · ${provider.title}`),
      effortSuffix ? h(Text, { color: '#64748b', dimColor: true }, effortSuffix) : null
    ),
    h(Spacer, null),
    h(
      Box,
      { flexDirection: 'row' },
      rightParts.length > 0
        ? rightParts.map((el, i) =>
            h(
              React.Fragment,
              { key: i },
              i > 0 ? h(Text, { color: '#64748b', dimColor: true }, ' · ') : null,
              el
            )
          )
        : h(Text, { color: '#64748b', dimColor: true }, 'новый диалог')
    )
  );
}
