/**
 * @fileoverview Поле ввода сообщений с историей и всплывающим меню команд
 */

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import TextInput from 'ink-text-input';
import { AVAILABLE_COMMANDS } from '../session-actions.js';

const h = React.createElement;

/**
 * Компонент поля ввода
 *
 * @param {object} props
 * @param {boolean} props.disabled - Заблокирован ли ввод (во время ответа агента)
 * @param {boolean} props.overlayOpen - Открыт ли оверлей (селектор, подтверждение и т.д.)
 * @param {(text: string) => void} props.onSend - Колбэк отправки введённого текста
 * @returns {React.ReactElement|null}
 */
export function InputBox({ disabled = false, overlayOpen = false, onSend }) {
  if (overlayOpen) {
    return null;
  }

  const [value, setValue] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const tempInputRef = useRef('');

  const isCommandMode = value.startsWith('/') && !value.includes(' ');
  const filteredCommands = isCommandMode
    ? AVAILABLE_COMMANDS.filter(c => c.cmd.startsWith(value))
    : [];

  useEffect(() => {
    setCommandIndex(0);
  }, [value]);

  usePaste((pasted) => {
    if (disabled || overlayOpen) return;
    const rawText = typeof pasted === 'string' ? pasted : pasted?.text || '';
    if (!rawText) return;
    const sanitized = rawText.replace(/\r?\n/g, ' ');
    setValue(prev => prev + sanitized);
  });

  useInput((input, key) => {
    if (key.escape) {
      setValue('');
      setCommandIndex(0);
      historyIndexRef.current = -1;
      return;
    }

    if (isCommandMode && filteredCommands.length > 0) {
      if (key.upArrow) {
        setCommandIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (key.downArrow) {
        setCommandIndex(prev => (prev + 1) % filteredCommands.length);
        return;
      }
      if (key.tab) {
        const target = filteredCommands[commandIndex]?.cmd || filteredCommands[0].cmd;
        setValue(target);
        return;
      }
    } else {
      // Навигация по истории сообщений в shell-стиле
      if (key.upArrow) {
        const hist = historyRef.current;
        if (hist.length > 0) {
          if (historyIndexRef.current === -1) {
            tempInputRef.current = value;
          }
          const nextIdx = historyIndexRef.current + 1;
          if (nextIdx < hist.length) {
            historyIndexRef.current = nextIdx;
            setValue(hist[hist.length - 1 - nextIdx]);
          }
        }
        return;
      }
      if (key.downArrow) {
        const hist = historyRef.current;
        if (historyIndexRef.current > 0) {
          const nextIdx = historyIndexRef.current - 1;
          historyIndexRef.current = nextIdx;
          setValue(hist[hist.length - 1 - nextIdx]);
        } else if (historyIndexRef.current === 0) {
          historyIndexRef.current = -1;
          setValue(tempInputRef.current);
        }
        return;
      }
    }
  }, { isActive: !disabled && !overlayOpen });

  const handleSubmit = (val) => {
    let finalValue = val;
    if (isCommandMode && filteredCommands.length > 0) {
      const selected = filteredCommands[commandIndex]?.cmd;
      if (selected) {
        finalValue = selected;
      }
    }

    const trimmed = finalValue.trim();
    if (!trimmed) return;

    historyRef.current.push(trimmed);
    historyIndexRef.current = -1;
    tempInputRef.current = '';
    setValue('');
    setCommandIndex(0);

    if (typeof onSend === 'function') {
      onSend(trimmed);
    }
  };

  const borderColor = disabled ? '#334155' : (value.length > 0 ? '#38bdf8' : '#38bdf8');

  return h(
    Box,
    { flexDirection: 'column', width: '100%' },
    h(
      Box,
      {
        borderStyle: 'round',
        borderColor: disabled ? '#334155' : borderColor,
        paddingX: 1,
        width: '100%'
      },
      h(Text, { color: '#38bdf8' }, '> '),
      disabled
        ? h(Text, { color: '#64748b', dimColor: true }, 'Ждём ответ… Esc — прервать')
        : h(TextInput, {
            value,
            onChange: setValue,
            onSubmit: handleSubmit,
            placeholder: 'Спросите что-нибудь или введите / для команд',
            focus: !disabled && !overlayOpen,
            showCursor: !disabled && !overlayOpen
          })
    ),
    isCommandMode
      ? h(
          Box,
          { flexDirection: 'column', paddingLeft: 1 },
          filteredCommands.length > 0
            ? filteredCommands.map((item, idx) => {
                const isSelected = idx === commandIndex;
                if (isSelected) {
                  return h(
                    Box,
                    { key: item.cmd, flexDirection: 'row' },
                    h(Text, { color: '#38bdf8' }, '❯ '),
                    h(Text, { bold: true, color: '#38bdf8' }, item.cmd.padEnd(10) + '  '),
                    h(Text, { color: '#94a3b8' }, item.desc)
                  );
                }
                return h(
                  Box,
                  { key: item.cmd, flexDirection: 'row' },
                  h(Text, null, '  '),
                  h(Text, { color: '#64748b' }, item.cmd.padEnd(10) + '  '),
                  h(Text, { color: '#64748b', dimColor: true }, item.desc)
                );
              })
            : h(Text, { color: '#64748b', dimColor: true }, '  нет такой команды')
        )
      : null
  );
}
