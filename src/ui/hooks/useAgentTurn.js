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
import { describeToolStart } from '../../toolDisplay.js';

/**
 * Формирует запись о завершении агентного хода с длительностью, токенами и списком изменений
 *
 * @param {number} turnElapsed - Длительность хода в мс
 * @param {object|null} lastUsage - Информация об использовании токенов
 * @param {Map<string, string>} changesMap - Карта изменений файлов
 * @returns {object}
 */
function buildDoneItem(turnElapsed, lastUsage, changesMap) {
  const totalTok = lastUsage?.total_tokens || 0;
  const tokFormatted = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k` : `${totalTok}`;
  const tokInfo = totalTok ? ` · ${tokFormatted} tok` : '';

  const created = [];
  const modified = [];
  const deleted = [];
  for (const [p, ch] of changesMap.entries()) {
    if (ch === 'created') created.push(p);
    else if (ch === 'modified') modified.push(p);
    else if (ch === 'deleted') deleted.push(p);
  }
  const changes = { created, modified, deleted };

  return {
    type: 'done',
    text: `✔ ${formatDuration(turnElapsed)}${tokInfo}`,
    changes
  };
}

/**
 * Создает объект обработчиков событий для runAgentTurn
 */
function createTurnEvents({
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
}) {
  return {
    takeQueued: () => {
      const taken = queueRef.current;
      queueRef.current = [];
      setQueued([]);
      return taken;
    },
    onQueuedInjected: (texts) => {
      lastActivityRef.current = Date.now();
      commitLiveText();
      setTranscript(prev => [
        ...prev,
        ...texts.map(text => ({ type: 'user', text }))
      ]);
    },
    onPhase: (p) => {
      lastActivityRef.current = Date.now();
      setPhase(p);
    },
    onModel: (id) => {
      lastActivityRef.current = Date.now();
      if (id && id !== session.model) {
        modelLabelRef.current = `${session.model} → ${id}`;
      }
    },
    onText: (delta) => {
      lastActivityRef.current = Date.now();
      queueLiveText(delta);
    },
    onStepEnd: async () => {
      lastActivityRef.current = Date.now();
      commitLiveText();
    },
    onToolStart: ({ id, name, args }) => {
      lastActivityRef.current = Date.now();
      const display = describeToolStart(name, args);
      const target = display?.target ?? args?.path ?? '';
      const next = [...liveToolsRef.current, { id, name, target, display, logs: [] }];
      liveToolsRef.current = next;
      setLiveTools(next);
    },
    onToolResult: ({ id, name, ok, summary, display }) => {
      lastActivityRef.current = Date.now();
      const prev = liveToolsRef.current;
      const item = prev.find(t => t.id === id) || { id, name, target: '', logs: [] };
      const target = display?.target ?? item.target ?? '';
      const title = display?.title;
      const toolSummary = display ? display.summary : summary;
      const diff = display?.diff || [];
      const change = display?.change || null;

      if (change && target) {
        const prevChange = changesRef.current.get(target);
        if (prevChange === 'created' && change === 'modified') {
          // оставить 'created'
        } else {
          changesRef.current.set(target, change);
        }
      }

      const toolResultItem = {
        type: 'tool',
        name: item.name || name,
        title,
        target,
        ok,
        summary: toolSummary,
        diff,
        change,
        logs: item.logs || []
      };
      const next = prev.filter(t => t.id !== id);
      liveToolsRef.current = next;
      setLiveTools(next);
      setTranscript(tPrev => [...tPrev, toolResultItem]);
    },
    onWarning: (msg) => {
      setTranscript(prev => [...prev, { type: 'note', level: 'warn', text: msg }]);
    }
  };
}

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

    const messagesToSend = [
      { role: 'system', content: session.systemPrompt },
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
        buildDoneItem(turnElapsed, lastUsage, changesRef.current)
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
              ? (hint ? `${hint} Контекст хода сохранён — можно написать «продолжай».` : 'Контекст хода сохранён — можно написать «продолжай».')
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
