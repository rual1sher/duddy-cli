/**
 * @fileoverview Отправка сообщений, управление очередью ввода и агентный цикл
 */

import { useState, useRef, useCallback } from 'react';
import { runAgentTurn } from '../../agent.js';
import { formatDuration } from '../../formatter.js';
import { commitTurn, commitFailedTurn } from '../../history.js';
import { handleModelError, errorText } from '../../errors.js';
import { clearModelBusy } from '../../models/status.js';
import { fetchKeyInfo } from '../../llm/modelInfo.js';
import { buildUserContent } from '../../images.js';
import { PLAN_MODE_PROMPT } from '../../modes.js';
import { systemPromptFor } from '../../config.js';
import { buildDoneItem, createTurnEvents } from './turnEvents.js';

/**
 * Хук агентного цикла исполнения запросов пользователя
 *
 * @param {object} params
 * @returns {object}
 */
export function useAgentTurn({
  session,
  toolCtxRef,
  lastActivityRef,
  liveToolsRef,
  setLiveTools,
  commitLiveText,
  queueLiveText,
  liveTextBufferRef,
  modelLabelRef,
  setTranscript,
  addNote,
  setDraft,
  handleCommand
}) {
  const [queued, setQueued] = useState([]);
  const [status, setStatus] = useState('idle');
  const [phase, setPhase] = useState('thinking');
  const [startedAt, setStartedAt] = useState(null);

  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const abortControllerRef = useRef(null);
  const changesRef = useRef(new Map());
  const sendRef = useRef(null);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSend = async (userText, images = []) => {
    const trimmed = userText.trim();
    if (!trimmed) return;

    if (busyRef.current) {
      if (trimmed.startsWith('/')) {
        addNote('warn', 'Команды недоступны во время ответа — дождитесь завершения или нажмите Esc');
        return;
      }
      queueRef.current.push(trimmed);
      setQueued([...queueRef.current]);
      return;
    }

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      return;
    }

    busyRef.current = true;
    changesRef.current.clear();
    setTranscript(prev => [...prev, { type: 'user', text: trimmed }]);
    setStatus('working');
    setPhase('thinking');
    const startMs = Date.now();
    setStartedAt(startMs);
    lastActivityRef.current = Date.now();

    abortControllerRef.current = new AbortController();
    modelLabelRef.current = session.model;
    liveTextBufferRef.current = '';

    const content = buildUserContent(trimmed, images);

    const basePrompt = systemPromptFor(session);
    const systemContent = toolCtxRef.current?.mode === 'plan'
      ? `${basePrompt}\n\n${PLAN_MODE_PROMPT}`
      : basePrompt;

    const messagesToSend = [
      { role: 'system', content: systemContent },
      ...(session.messages || []),
      { role: 'user', content }
    ];

    let succeeded = false;

    try {
      const { finalText, newMessages, lastUsage, elapsedMs } = await runAgentTurn({
        session,
        messages: messagesToSend,
        toolCtx: toolCtxRef.current,
        signal: abortControllerRef.current.signal,
        events: createTurnEvents({
          queueRef,
          setQueued,
          lastActivityRef,
          commitLiveText,
          setTranscript,
          setPhase,
          session,
          modelLabelRef,
          queueLiveText,
          liveToolsRef,
          setLiveTools,
          changesRef
        })
      });

      commitTurn(session, content, newMessages, finalText);
      succeeded = true;
      clearModelBusy(session.provider, session.model);

      const turnElapsed = elapsedMs ?? (Date.now() - startMs);
      session.lastTurnMs = turnElapsed;
      if (lastUsage) {
        session.lastUsage = lastUsage;
      }

      setTranscript(prev => [
        ...prev,
        buildDoneItem(turnElapsed, changesRef.current)
      ]);

      if (session.apiKey) {
        fetchKeyInfo(session.apiKey, session.provider)
          .then(info => {
            if (info) session.keyInfo = info;
          })
          .catch(() => {});
      }
    } catch (err) {
      const kept = commitFailedTurn(session, content, err);
      if (err.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
        setTranscript(prev => [
          ...prev,
          {
            type: 'note',
            level: 'warn',
            text: `Остановлено · ${formatDuration(Date.now() - startMs)}`
          }
        ]);
      } else {
        const hint = handleModelError(err, session);
        setTranscript(prev => [
          ...prev,
          {
            type: 'note',
            level: 'error',
            text: errorText(err),
            hint: kept
              ? (hint
                  ? `${hint} Контекст хода сохранён — можно написать «продолжай».`
                  : 'Контекст хода сохранён — можно написать «продолжай».')
              : hint
          }
        ]);
      }
    } finally {
      commitLiveText();
      liveToolsRef.current = [];
      setLiveTools([]);
      setStatus('idle');
      setPhase('thinking');
      setStartedAt(null);
      busyRef.current = false;

      if (queueRef.current.length > 0) {
        const queuedItems = queueRef.current;
        queueRef.current = [];
        setQueued([]);
        if (succeeded) {
          const joined = queuedItems.join('\n\n');
          setTimeout(() => {
            if (typeof sendRef.current === 'function') {
              sendRef.current(joined);
            }
          }, 0);
        } else {
          const joined = queuedItems.join(' ');
          setDraft(d => ({ text: joined, key: d.key + 1 }));
        }
      }
    }
  };

  sendRef.current = handleSend;

  return {
    handleSend,
    abort,
    status,
    phase,
    startedAt,
    queued,
    queueRef,
    setQueued
  };
}
