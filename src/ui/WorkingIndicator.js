/**
 * @fileoverview Индикатор активной работы ИИ и вспомогательные функции анимации
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { formatDuration } from '../formatter.js';
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
 * Координаты [x, y] 4 пикселей кольца 2×2 по часовой стрелке, начиная с (0,0)
 */
export const RING_PATH = [
  [0, 0], [1, 0], [1, 1], [0, 1]
];

/**
 * Вычисляет 2×2 сетку уровней яркости кольцевого индикатора для заданного шага анимации.
 *
 * @param {number} tick - Текущий шаг анимации
 * @returns {string[][]} Сетка 2×2 grid[y][x] со значениями 'head' | 'trail1' | 'trail2' | 'track'
 */
export function ringPixels(tick) {
  const grid = [
    [null, null],
    [null, null]
  ];
  const head = ((tick % 4) + 4) % 4;

  for (let k = 0; k < RING_PATH.length; k++) {
    const [x, y] = RING_PATH[k];
    const d = (head - k + 4) % 4;
    let level;
    if (d === 0) {
      level = 'head';
    } else if (d === 1) {
      level = 'trail1';
    } else if (d === 2) {
      level = 'trail2';
    } else {
      level = 'track';
    }
    grid[y][x] = level;
  }

  return grid;
}

/**
 * Преобразует сетку пикселей кольца в 1 строку из 2 терминальных ячеек с полублоками.
 *
 * @param {number} tick - Текущий шаг анимации
 * @returns {{ char: string, top: string, bottom: string }[][]} Массив 1×2 ячеек
 */
export function ringCells(tick) {
  const pixels = ringPixels(tick);
  const row = [];

  for (let c = 0; c < 2; c++) {
    const top = pixels[0][c];
    const bottom = pixels[1][c];
    row.push({ char: '▀', top, bottom });
  }

  return [row];
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
 * @returns {React.ReactElement|null}
 */
export function WorkingIndicator({ status, phase, startedAt, getLastActivity, waitingForUser = false }) {
  const t = theme();
  const { tick, now } = useTicker(status === 'working');

  if (status !== 'working') {
    return null;
  }

  const spinnerChar = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
  const label = phaseLabel(phase, waitingForUser);
  const silent = now - (getLastActivity?.() || startedAt || now);
  const isSlow = !waitingForUser && phase !== 'tools' && silent > 20000;

  return h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: t.accent }, `${spinnerChar} ${label}… ${formatDuration(elapsed)}`),
      isSlow
        ? h(Text, { color: t.warning }, ` · нет ответа ${formatDuration(silent)}`)
        : null
    )
  );
}
