/**
 * @fileoverview Компонент безопасного ввода скрытого текста (API-ключей)
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const h = React.createElement;

/**
 * Компонент скрытого ввода паролей и API-ключей
 *
 * @param {object} props
 * @param {string} props.title - Заголовок запроса
 * @param {(value: string) => void} props.onSubmit - Колбэк подтверждения ввода
 * @param {() => void} props.onCancel - Колбэк отмены
 * @param {string} [props.placeholder='']
 * @returns {React.ReactElement}
 */
export function SecretInput({ title, onSubmit, onCancel, placeholder = '' }) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      if (typeof onCancel === 'function') onCancel();
    }
  });

  const handleSubmit = (val) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (typeof onSubmit === 'function') {
      onSubmit(trimmed);
    }
  };

  return h(
    Box,
    {
      borderStyle: 'round',
      borderColor: '#334155',
      paddingX: 1,
      flexDirection: 'column',
      width: '100%'
    },
    h(Text, { bold: true, color: '#38bdf8' }, title),
    h(
      Box,
      { marginTop: 1, flexDirection: 'row' },
      h(Text, { color: '#38bdf8' }, '🔑 '),
      h(TextInput, {
        value,
        onChange: setValue,
        onSubmit: handleSubmit,
        mask: '•',
        focus: true,
        placeholder
      })
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: '#64748b', dimColor: true }, 'Enter — подтвердить · Esc — отмена')
    )
  );
}
