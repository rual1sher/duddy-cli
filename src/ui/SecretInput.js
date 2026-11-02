/**
 * @fileoverview Компонент безопасного ввода скрытого текста (API-ключей)
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import TextInput from 'ink-text-input';
import { readClipboardText } from '../images.js';

const h = React.createElement;

/**
 * Обработчик клавиш поля ввода. Монтируется после TextInput с тем же key,
 * чтобы подписаться позже него: обработка Ctrl+V убирает уже вставленный им символ.
 *
 * @param {object} props
 * @param {(input: string, key: object) => void} props.onInput - Обработчик клавиш
 * @returns {null}
 */
function InputKeys({ onInput }) {
  useInput(onInput);
  return null;
}

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
  const [inputKey, setInputKey] = useState(0);
  const prevValueRef = useRef('');

  const appendCleaned = (raw) => {
    const text = typeof raw === 'string' ? raw : raw?.text || '';
    const cleaned = text.replace(/[\s\x00-\x1f\x7f]/g, '');
    if (!cleaned) return;
    setValue(prev => prev + cleaned);
    setInputKey(k => k + 1);
  };

  usePaste((pasted) => {
    appendCleaned(pasted);
  });

  const handleInputChange = (next) => {
    prevValueRef.current = value;
    setValue(next);
  };

  const handleKey = (input, key) => {
    if (key.escape) {
      if (typeof onCancel === 'function') onCancel();
      return;
    }

    if (key.ctrl && input === 'v') {
      setValue(prevValueRef.current);
      readClipboardText()
        .then((text) => {
          if (!text) return;
          appendCleaned(text);
        })
        .catch(() => {});
      return;
    }
  };

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
        key: `input-${inputKey}`,
        value,
        onChange: handleInputChange,
        onSubmit: handleSubmit,
        mask: '•',
        focus: true,
        placeholder
      }),
      h(InputKeys, { key: `keys-${inputKey}`, onInput: handleKey })
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: '#64748b', dimColor: true }, 'Enter — подтвердить · Esc — отмена')
    )
  );
}
