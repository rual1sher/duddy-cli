/**
 * @fileoverview Поле ввода сообщений с историей и всплывающим меню команд
 */

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { PromptInput } from './PromptInput.js';
import { theme } from '../render/theme.js';
import { formatBytes } from '../images/images.js';
import { useInputHistory } from './hooks/useInputHistory.js';
import { useAttachments } from './hooks/useAttachments.js';
import { CommandMenu } from './CommandMenu.js';

const h = React.createElement;

/**
 * Обработчик клавиш поля ввода. Монтируется после PromptInput с тем же key,
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
 * Компонент поля ввода
 *
 * @param {object} props
 * @param {boolean} [props.busy=false] - Занят ли агент ответом
 * @param {Array<string>} [props.queued=[]] - Очередь сообщений, ожидающих обработки
 * @param {string} [props.draft=''] - Черновик текста для восстановления
 * @param {number} [props.draftKey=0] - Ключ обновления черновика
 * @param {boolean} [props.overlayOpen=false] - Открыт ли оверлей (селектор, подтверждение и т.д.)
 * @param {boolean} [props.imagesSupported=true] - Поддерживает ли текущая модель изображения
 * @param {Array<{ cmd: string, desc: string }>} [props.commands=[]] - Доступные слеш-команды
 * @param {(text: string, images?: Array<{ mime: string, data: Buffer }>) => void} props.onSend - Колбэк отправки
 * @returns {React.ReactElement|null}
 */
export function InputBox({
  busy = false,
  queued = [],
  draft = '',
  draftKey = 0,
  overlayOpen = false,
  imagesSupported = true,
  commands = [],
  onSend
}) {
  const t = theme();
  const windowSize = useWindowSize();
  const columns = windowSize?.columns || process.stdout.columns || 80;
  const rows = windowSize?.rows || process.stdout.rows || 24;
  const width = Math.max(10, columns - 6);
  const maxLines = Math.max(3, Math.min(10, Math.floor(rows / 3)));
  const [value, setValue] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const prevValueRef = useRef('');

  // PromptInput двигает курсор только при своём вводе, смена key пересоздаёт его с курсором в конце
  const setValueAtEnd = (next) => {
    setValue(next);
    setInputKey(k => k + 1);
  };

  const {
    navigateUp,
    navigateDown,
    pushHistory,
    resetHistoryIndex
  } = useInputHistory({ setValueAtEnd });

  const {
    attachments,
    notice,
    setNotice,
    cleanLabels,
    pasteClipboardImage,
    resetAttachments,
    getImagesForSubmit
  } = useAttachments({ overlayOpen, setValueAtEnd });

  const isCommandMode = value.startsWith('/') && !value.includes(' ');
  const filteredCommands = isCommandMode
    ? commands.filter(c => c.cmd.startsWith(value))
    : [];

  useEffect(() => {
    setCommandIndex(0);
  }, [value]);

  useEffect(() => {
    if (draftKey > 0) {
      setValueAtEnd(prev => (prev ? `${draft} ${prev}` : draft));
      resetHistoryIndex();
    }
  }, [draftKey, draft]);

  const handleInputChange = (next) => {
    prevValueRef.current = value;
    const cleaned = cleanLabels(value, next);
    if (cleaned !== next) {
      setValueAtEnd(cleaned);
    } else {
      setValue(next);
    }
  };

  const handleKey = (input, key) => {
    if (key.escape) {
      if (busy) {
        return;
      }
      setValue('');
      setCommandIndex(0);
      resetHistoryIndex();
      resetAttachments();
      return;
    }

    if (key.ctrl && input === 's') {
      setValue(prevValueRef.current);
      return;
    }

    if (key.ctrl && input === 'v') {
      setValue(prevValueRef.current);
      pasteClipboardImage();
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
      if (key.tab && !key.shift) {
        const target = filteredCommands[commandIndex]?.cmd || filteredCommands[0].cmd;
        setValueAtEnd(target);
        return;
      }
    } else {
      if (key.upArrow) {
        navigateUp(value);
        return;
      }
      if (key.downArrow) {
        navigateDown();
        return;
      }
    }
  };

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

    const images = getImagesForSubmit(finalValue, { imagesSupported, busy });
    if (images === null) return;

    setNotice(null);
    pushHistory(trimmed);
    setValue('');
    setCommandIndex(0);
    resetAttachments();

    if (typeof onSend === 'function') {
      onSend(trimmed, images);
    }
  };

  if (overlayOpen) {
    return null;
  }

  return h(
    Box,
    { flexDirection: 'column', width: '100%' },
    queued.length > 0
      ? h(
          Box,
          { flexDirection: 'column', paddingLeft: 1 },
          queued.map((text, idx) =>
            h(
              Box,
              { key: idx, flexDirection: 'row' },
              h(Text, { color: t.subtle }, '⏳ '),
              h(Text, { color: t.muted, dimColor: true }, text)
            )
          )
        )
      : null,
    attachments.length > 0
      ? h(
          Box,
          { flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 1, columnGap: 1 },
          attachments.map(att =>
            h(
              Box,
              { key: att.n, flexShrink: 0 },
              h(Text, { color: t.muted }, `📎 ${att.label} · ${formatBytes(att.data?.length || 0)}`)
            )
          )
        )
      : null,
    h(
      Box,
      {
        borderStyle: 'round',
        borderColor: t.accent,
        paddingX: 1,
        width: '100%',
        flexDirection: 'row'
      },
      h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: t.accent }, '> ')),
      h(
        Box,
        { flexGrow: 1, flexShrink: 1, flexDirection: 'column' },
        h(PromptInput, {
          key: `input-${inputKey}`,
          value,
          onChange: handleInputChange,
          onSubmit: handleSubmit,
          placeholder: busy
            ? 'Напишите — сообщение будет добавлено к текущему ответу'
            : 'Спросите что-нибудь, / — команды, Ctrl+V — картинка',
          focus: !overlayOpen,
          showCursor: !overlayOpen,
          width,
          maxLines
        }),
        h(InputKeys, { key: `keys-${inputKey}`, onInput: handleKey })
      )
    ),
    notice
      ? h(
          Box,
          { paddingLeft: 1 },
          h(Text, { color: t.warning }, notice)
        )
      : null,
    isCommandMode
      ? h(CommandMenu, { filteredCommands, commandIndex })
      : null
  );
}
