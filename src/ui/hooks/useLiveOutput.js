/**
 * @fileoverview Управление буфером и таймерами живого вывода стриминга и инструментов в TUI
 */

import { useState, useRef, useCallback } from 'react';
import { renderMarkdown } from '../../formatter.js';

/**
 * Хук для управления живым выводом стриминга текста и выполняемых инструментов
 *
 * @param {object} params
 * @param {Function} params.setTranscript
 * @param {React.MutableRefObject<string>} params.modelLabelRef
 * @returns {object}
 */
export function useLiveOutput({ setTranscript, modelLabelRef }) {
  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState([]);

  const liveToolsRef = useRef([]);
  const liveTextBufferRef = useRef('');
  const liveTextTimerRef = useRef(null);

  const flushLiveText = useCallback(() => {
    if (liveTextTimerRef.current) {
      clearTimeout(liveTextTimerRef.current);
      liveTextTimerRef.current = null;
    }
    setLiveText(liveTextBufferRef.current);
  }, []);

  const commitLiveText = useCallback(() => {
    flushLiveText();
    if (!liveTextBufferRef.current.trim()) {
      liveTextBufferRef.current = '';
      setLiveText('');
      return;
    }
    const rendered = renderMarkdown(liveTextBufferRef.current);
    setTranscript(prev => [
      ...prev,
      { type: 'assistant', lines: rendered, label: modelLabelRef.current }
    ]);
    liveTextBufferRef.current = '';
    setLiveText('');
  }, [flushLiveText, setTranscript, modelLabelRef]);

  const queueLiveText = useCallback((delta) => {
    liveTextBufferRef.current += delta;
    if (!liveTextTimerRef.current) {
      liveTextTimerRef.current = setTimeout(() => {
        liveTextTimerRef.current = null;
        setLiveText(liveTextBufferRef.current);
      }, 50);
    }
  }, []);

  const resetLiveTools = useCallback(() => {
    liveToolsRef.current = [];
    setLiveTools([]);
  }, []);

  const resetLiveOutput = useCallback(() => {
    if (liveTextTimerRef.current) {
      clearTimeout(liveTextTimerRef.current);
      liveTextTimerRef.current = null;
    }
    liveTextBufferRef.current = '';
    setLiveText('');
    liveToolsRef.current = [];
    setLiveTools([]);
  }, []);

  return {
    liveText,
    setLiveText,
    liveTools,
    setLiveTools,
    liveToolsRef,
    liveTextBufferRef,
    liveTextTimerRef,
    flushLiveText,
    commitLiveText,
    queueLiveText,
    resetLiveTools,
    resetLiveOutput
  };
}
