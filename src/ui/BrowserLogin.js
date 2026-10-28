/**
 * @fileoverview Компонент ожидания авторизации OpenRouter через браузер
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const h = React.createElement;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Компонент окна ожидания авторизации через браузер
 *
 * @param {object} props
 * @param {string} props.url - Ссылка авторизации
 * @param {() => void} props.cancel - Функция отмены авторизации
 * @returns {React.ReactElement}
 */
export function BrowserLogin({ url, cancel }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      if (typeof cancel === 'function') cancel();
    }
  });

  const spinner = SPINNER_FRAMES[frameIndex];

  return h(
    Box,
    {
      borderStyle: 'round',
      borderColor: '#334155',
      paddingX: 1,
      flexDirection: 'column',
      width: '100%'
    },
    h(Text, { bold: true, color: '#38bdf8' }, 'Вход в OpenRouter через браузер'),
    h(
      Box,
      { marginTop: 1, marginBottom: 1 },
      h(Text, { underline: true, color: '#38bdf8' }, url)
    ),
    h(
      Box,
      { flexDirection: 'row' },
      h(Text, { color: '#38bdf8' }, `${spinner} `),
      h(Text, { color: '#94a3b8' }, 'Ожидание входа в браузере… '),
      h(Text, { color: '#64748b', dimColor: true }, 'Esc — отмена')
    )
  );
}
