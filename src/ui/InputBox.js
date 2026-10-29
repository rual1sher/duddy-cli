/**
 * @fileoverview Поле ввода сообщений с историей и всплывающим меню команд
 */

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import TextInput from 'ink-text-input';
import { AVAILABLE_COMMANDS } from '../session-actions.js';
import {
  readClipboardImage,
  parseImagePaths,
  loadImageFile,
  formatBytes,
  MAX_IMAGES_PER_MESSAGE
} from '../images.js';

const h = React.createElement;

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
 * @param {(text: string, images?: Array<{ mime: string, data: Buffer }>) => void} props.onSend - Колбэк отправки введённого текста и вложений
 * @returns {React.ReactElement|null}
 */
export function InputBox({
  busy = false,
  queued = [],
  draft = '',
  draftKey = 0,
  overlayOpen = false,
  imagesSupported = true,
  onSend
}) {
  const [value, setValue] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const [notice, setNotice] = useState(null);

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const tempInputRef = useRef('');
  const attachmentCounterRef = useRef(0);
  const prevValueRef = useRef('');
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const isCommandMode = value.startsWith('/') && !value.includes(' ');
  const filteredCommands = isCommandMode
    ? AVAILABLE_COMMANDS.filter(c => c.cmd.startsWith(value))
    : [];

  useEffect(() => {
    setCommandIndex(0);
  }, [value]);

  useEffect(() => {
    if (draftKey > 0) {
      setValue(prev => (prev ? `${draft} ${prev}` : draft));
      historyIndexRef.current = -1;
    }
  }, [draftKey, draft]);

  const handleInputChange = (next) => {
    prevValueRef.current = value;
    setValue(next);
    if (notice) {
      setNotice(null);
    }
  };

  usePaste((pasted) => {
    if (overlayOpen) return;
    const rawText = typeof pasted === 'string' ? pasted : pasted?.text || '';
    if (!rawText) return;

    const imagePaths = parseImagePaths(rawText);
    if (imagePaths) {
      if (notice) setNotice(null);
      try {
        if (attachmentsRef.current.length + imagePaths.length > MAX_IMAGES_PER_MESSAGE) {
          throw new Error(`Нельзя прикрепить больше ${MAX_IMAGES_PER_MESSAGE} изображений`);
        }
        const loaded = imagePaths.map(p => loadImageFile(p));
        const newAttachments = [];
        for (const img of loaded) {
          attachmentCounterRef.current += 1;
          const nextN = attachmentCounterRef.current;
          const label = `[Изображение #${nextN}]`;
          newAttachments.push({ n: nextN, mime: img.mime, data: img.data, label });
        }
        setAttachments(prev => [...prev, ...newAttachments]);
        const labelsStr = newAttachments.map(a => a.label).join(' ');
        setValue(prev => {
          if (!prev) return labelsStr;
          if (prev.endsWith(' ')) return `${prev}${labelsStr}`;
          return `${prev} ${labelsStr}`;
        });
      } catch (err) {
        setNotice(err.message);
      }
      return;
    }

    const sanitized = rawText.replace(/\r?\n/g, ' ');
    setValue(prev => prev + sanitized);
  });

  useInput((input, key) => {
    if (key.escape) {
      if (busy) {
        return;
      }
      setValue('');
      setCommandIndex(0);
      historyIndexRef.current = -1;
      setAttachments([]);
      attachmentCounterRef.current = 0;
      setNotice(null);
      return;
    }

    if (key.ctrl && input === 'v') {
      setValue(prevValueRef.current);

      if (attachmentsRef.current.length >= MAX_IMAGES_PER_MESSAGE) {
        setNotice(`Нельзя прикрепить больше ${MAX_IMAGES_PER_MESSAGE} изображений`);
        return;
      }

      readClipboardImage()
        .then((img) => {
          if (!img) {
            setNotice('В буфере нет изображения (текст вставляется Ctrl+Shift+V)');
            return;
          }

          if (attachmentsRef.current.length >= MAX_IMAGES_PER_MESSAGE) {
            setNotice(`Нельзя прикрепить больше ${MAX_IMAGES_PER_MESSAGE} изображений`);
            return;
          }

          attachmentCounterRef.current += 1;
          const nextN = attachmentCounterRef.current;
          const label = `[Изображение #${nextN}]`;

          setAttachments(prev => [...prev, { n: nextN, mime: img.mime, data: img.data, label }]);
          setNotice(null);

          setValue(prev => {
            if (!prev) return label;
            if (prev.endsWith(' ')) return `${prev}${label}`;
            return `${prev} ${label}`;
          });
        })
        .catch((err) => {
          setNotice(err.message);
        });

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
  }, { isActive: !overlayOpen });

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

    const activeAttachments = attachments.filter(att => finalValue.includes(att.label));
    const images = activeAttachments.map(att => ({ mime: att.mime, data: att.data }));

    if (images.length > 0 && imagesSupported === false) {
      setNotice('Текущая модель не принимает изображения — выберите другую через /model');
      return;
    }

    if (images.length > 0 && busy) {
      setNotice('Изображение можно отправить, когда ответ закончится');
      return;
    }

    setNotice(null);
    historyRef.current.push(trimmed);
    historyIndexRef.current = -1;
    tempInputRef.current = '';
    setValue('');
    setCommandIndex(0);
    setAttachments([]);
    attachmentCounterRef.current = 0;

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
              h(Text, { color: '#64748b' }, '⏳ '),
              h(Text, { color: '#94a3b8', dimColor: true }, text)
            )
          )
        )
      : null,
    attachments.length > 0
      ? h(
          Box,
          { flexDirection: 'row', paddingLeft: 1, gap: 1 },
          attachments.map(att =>
            h(
              Text,
              { key: att.n, color: '#94a3b8' },
              `📎 ${att.label} · ${formatBytes(att.data?.length || 0)}`
            )
          )
        )
      : null,
    h(
      Box,
      {
        borderStyle: 'round',
        borderColor: '#38bdf8',
        paddingX: 1,
        width: '100%'
      },
      h(Text, { color: '#38bdf8' }, '> '),
      h(TextInput, {
        value,
        onChange: handleInputChange,
        onSubmit: handleSubmit,
        placeholder: busy
          ? 'Напишите — сообщение будет добавлено к текущему ответу'
          : 'Спросите что-нибудь, / — команды, Ctrl+V — картинка',
        focus: !overlayOpen,
        showCursor: !overlayOpen
      })
    ),
    notice
      ? h(
          Box,
          { paddingLeft: 1 },
          h(Text, { color: '#f59e0b' }, notice)
        )
      : null,
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
