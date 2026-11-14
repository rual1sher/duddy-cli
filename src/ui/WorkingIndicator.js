/**
 * @fileoverview Индикатор активной работы ИИ и вспомогательные функции анимации
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../render/theme.js';
import { formatDuration } from '../render/formatter.js';
import { useTicker } from './hooks/useTicker.js';

const h = React.createElement;

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Возвращает метку текущей фазы работы ИИ
 *
 * @param {string} [phase] - Текущая фаза ('reasoning', 'tools' и др.)
 * @param {boolean} [waitingForUser=false] - Флаг ожидания подтверждения пользователя
 * @returns {string}
 */
export function phaseLabel(phase, waitingForUser = false) {
  if (waitingForUser) return 'Ждёт подтверждения';
  if (phase === 'reasoning') return 'Рассуждает';
  if (phase === 'tools') return 'Выполняет инструменты';
  return 'Думает';
}

/**
 * Индикатор работы ИИ в области диалога
 *
 * @param {object} props
 * @param {'idle'|'working'} props.status
 * @param {string} [props.phase]
 * @param {number|null} [props.startedAt]
 * @param {() => number} [props.getLastActivity]
 * @param {boolean} [props.waitingForUser=false]
 * @param {() => number} [props.getPausedMs]
 * @returns {React.ReactElement|null}
 */
export function WorkingIndicator({
  status,
  phase,
  startedAt,
  getLastActivity,
  waitingForUser = false,
  getPausedMs = () => 0
}) {
  const t = theme();
  const { tick, now } = useTicker(status === 'working');

  if (status !== 'working') {
    return null;
  }

  const spinnerChar = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
  const pausedMs = typeof getPausedMs === 'function' ? getPausedMs() : 0;
  const elapsed = startedAt ? Math.max(0, now - startedAt - pausedMs) : 0;
  const label = phaseLabel(phase, waitingForUser);
  const silent = now - (getLastActivity?.() || startedAt || now);
  const isSlow = !waitingForUser && phase !== 'tools' && silent > 20000;
  const mainText = waitingForUser
    ? `${spinnerChar} ${label}…`
    : `${spinnerChar} ${label}… ${formatDuration(elapsed)}`;

  return h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: t.accent }, mainText),
      isSlow
        ? h(Text, { color: t.warning }, ` · нет ответа ${formatDuration(silent)}`)
        : null
    )
  );
}
