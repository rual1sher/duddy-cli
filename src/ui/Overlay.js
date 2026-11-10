/**
 * @fileoverview Отрисовка модальных оверлеев TUI (Picker, SecretInput, Approval, BrowserLogin, loading)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Picker } from './Picker.js';
import { SecretInput } from './SecretInput.js';
import { Approval } from './Approval.js';
import { BrowserLogin } from './BrowserLogin.js';
import { theme } from '../theme.js';

const h = React.createElement;

/**
 * Выбирает и отображает компонент оверлея по overlay.kind
 *
 * @param {object} props
 * @param {object|null} props.overlay - Описание активного оверлея
 * @returns {React.ReactElement|null}
 */
export function Overlay({ overlay }) {
  const t = theme();
  if (!overlay) return null;

  if (overlay.kind === 'picker') {
    return h(Picker, overlay);
  }
  if (overlay.kind === 'secret') {
    return h(SecretInput, overlay);
  }
  if (overlay.kind === 'approval') {
    return h(Approval, overlay);
  }
  if (overlay.kind === 'browser') {
    return h(BrowserLogin, overlay);
  }
  if (overlay.kind === 'recording') {
    return h(
      Box,
      {
        borderStyle: 'round',
        borderColor: 'red',
        paddingX: 1,
        flexDirection: 'row',
        width: '100%'
      },
      h(Text, { color: 'red' }, '● '),
      h(Text, { color: t.text, bold: true }, overlay.text || 'Слушаю микрофон… Говорите (нажмите Enter или Ctrl+S для отправки)')
    );
  }
  if (overlay.kind === 'loading') {
    return h(
      Box,
      {
        borderStyle: 'round',
        borderColor: t.border,
        paddingX: 1,
        flexDirection: 'row',
        width: '100%'
      },
      h(Text, { color: t.accent }, '⠋ '),
      h(Text, { color: t.text }, overlay.text)
    );
  }

  return null;
}
