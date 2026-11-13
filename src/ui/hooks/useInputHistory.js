/**
 * @fileoverview Пользовательский хук управления историей введённых сообщений (shell-стиль, клавиши ↑/↓)
 */

import { useRef } from 'react';

/**
 * Хук навигации по истории сообщений в shell-стиле
 *
 * @param {object} params
 * @param {(value: string) => void} params.setValueAtEnd - Функция установки значения поля ввода
 * @returns {object} Методы управления историей ввода
 */
export function useInputHistory({ setValueAtEnd }) {
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const tempInputRef = useRef('');

  const navigateUp = (currentValue) => {
    const hist = historyRef.current;
    if (hist.length === 0) return;

    if (historyIndexRef.current === -1) {
      tempInputRef.current = currentValue;
    }
    const nextIdx = historyIndexRef.current + 1;
    if (nextIdx < hist.length) {
      historyIndexRef.current = nextIdx;
      setValueAtEnd(hist[hist.length - 1 - nextIdx]);
    }
  };

  const navigateDown = () => {
    const hist = historyRef.current;
    if (historyIndexRef.current > 0) {
      const nextIdx = historyIndexRef.current - 1;
      historyIndexRef.current = nextIdx;
      setValueAtEnd(hist[hist.length - 1 - nextIdx]);
    } else if (historyIndexRef.current === 0) {
      historyIndexRef.current = -1;
      setValueAtEnd(tempInputRef.current);
    }
  };

  const pushHistory = (text) => {
    const trimmed = text.trim();
    if (trimmed) {
      historyRef.current.push(trimmed);
    }
    historyIndexRef.current = -1;
    tempInputRef.current = '';
  };

  const resetHistoryIndex = () => {
    historyIndexRef.current = -1;
  };

  return {
    navigateUp,
    navigateDown,
    pushHistory,
    resetHistoryIndex
  };
}
