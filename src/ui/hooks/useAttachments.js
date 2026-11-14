/**
 * @fileoverview Пользовательский хук обработки вложений изображений и буфера обмена (Ctrl+V, пути файлов)
 */

import { useState, useRef } from 'react';
import { usePaste } from 'ink';
import { readClipboardImage } from '../../images/clipboard.js';
import { parseImagePaths } from '../../images/imagePaths.js';
import {
  loadImageFile,
  removeBrokenLabels,
  MAX_IMAGES_PER_MESSAGE
} from '../../images/images.js';

/**
 * Хук работы с вложениями изображений в поле ввода
 *
 * @param {object} params
 * @param {boolean} params.overlayOpen - Открыт ли оверлей (селектор, подтверждение и т.д.)
 * @param {(valueOrUpdater: string|Function) => void} params.setValueAtEnd - Установка значения с курсором в конце
 * @returns {object} Состояние и методы управления вложениями
 */
export function useAttachments({ overlayOpen, setValueAtEnd }) {
  const [attachments, setAttachments] = useState([]);
  const [notice, setNotice] = useState(null);
  const attachmentCounterRef = useRef(0);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  usePaste((pasted) => {
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
        setValueAtEnd(prev => {
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
    setValueAtEnd(prev => prev + sanitized);
  }, { isActive: !overlayOpen });

  const cleanLabels = (currentValue, nextValue) => {
    const cleaned = removeBrokenLabels(
      currentValue,
      nextValue,
      attachmentsRef.current.map(att => att.label)
    );
    if (notice) {
      setNotice(null);
    }
    const kept = attachmentsRef.current.filter(att => cleaned.includes(att.label));
    if (kept.length !== attachmentsRef.current.length) {
      setAttachments(kept);
      if (kept.length === 0) {
        attachmentCounterRef.current = 0;
      }
    }
    return cleaned;
  };

  const pasteClipboardImage = () => {
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

        setValueAtEnd(prev => {
          if (!prev) return label;
          if (prev.endsWith(' ')) return `${prev}${label}`;
          return `${prev} ${label}`;
        });
      })
      .catch((err) => {
        setNotice(err.message);
      });
  };

  const resetAttachments = () => {
    setAttachments([]);
    attachmentCounterRef.current = 0;
    setNotice(null);
  };

  const getImagesForSubmit = (finalValue, { imagesSupported, busy }) => {
    const activeAttachments = attachments.filter(att => finalValue.includes(att.label));
    const images = activeAttachments.map(att => ({ mime: att.mime, data: att.data }));

    if (images.length > 0 && imagesSupported === false) {
      setNotice('Текущая модель не принимает изображения — выберите другую через /model');
      return null;
    }

    if (images.length > 0 && busy) {
      setNotice('Изображение можно отправить, когда ответ закончится');
      return null;
    }

    return images;
  };

  return {
    attachments,
    notice,
    setNotice,
    cleanLabels,
    pasteClipboardImage,
    resetAttachments,
    getImagesForSubmit
  };
}
