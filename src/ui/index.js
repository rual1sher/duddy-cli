/**
 * @fileoverview Точка входа интерактивного терминального интерфейса (Ink TUI)
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { startAtTop } from './hooks/useResizeRedraw.js';

const h = React.createElement;

/**
 * Запускает современный интерактивный TUI-интерфейс Duddy на базе Ink
 *
 * @param {object} session - Текущая сессия Duddy
 * @returns {Promise<void>}
 */
export async function startTui(session) {
  // Сдвигаем предыдущий вывод в scrollback и ставим курсор в начало экрана
  if (process.stdout.isTTY) {
    process.stdout.write(startAtTop());
  }
  const { waitUntilExit } = render(h(App, { session }), { exitOnCtrlC: false });
  await waitUntilExit();
}
