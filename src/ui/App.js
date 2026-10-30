/**
 * @fileoverview Корневой компонент TUI-интерфейса Duddy (Ink)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Transcript } from './Transcript.js';
import { StatusBar } from './StatusBar.js';
import { InputBox } from './InputBox.js';
import { LiveOutput } from './LiveOutput.js';
import { Overlay } from './Overlay.js';
import { useLiveOutput } from './hooks/useLiveOutput.js';
import { useToolContext } from './hooks/useToolContext.js';
import { useLoginFlows } from './hooks/useLoginFlows.js';
import { useResizeRedraw } from './hooks/useResizeRedraw.js';
import { useCommands } from './hooks/useCommands.js';
import { useAgentTurn } from './hooks/useAgentTurn.js';
import { listModels, findModel } from '../models/catalog.js';
import { loadConfig } from '../config.js';
import { fetchKeyInfo, getModelContextLength } from '../llm/modelInfo.js';

const h = React.createElement;

/**
 * Главный компонент приложения Duddy TUI
 *
 * @param {object} props
 * @param {object} props.session - Сессия пользователя
 * @returns {React.ReactElement}
 */
export function App({ session }) {
  const app = useApp();

  const [transcript, setTranscript] = useState([{ type: 'banner' }]);
  const [staticKey, setStaticKey] = useState(0);
  const [overlay, setOverlay] = useState(null);
  const [draft, setDraft] = useState({ text: '', key: 0 });

  const lastActivityRef = useRef(0);
  const lastSigintRef = useRef(0);
  const modelLabelRef = useRef('');
  const handleCommandRef = useRef(null);

  const addNote = useCallback((level, text) => {
    setTranscript(prev => [...prev, { type: 'note', level, text }]);
  }, []);

  const {
    liveText,
    liveTools,
    liveToolsRef,
    liveTextBufferRef,
    setLiveTools,
    commitLiveText,
    queueLiveText
  } = useLiveOutput({ setTranscript, modelLabelRef });

  const { toolCtxRef } = useToolContext({
    session,
    liveToolsRef,
    setLiveTools,
    setOverlay,
    lastActivityRef
  });

  const {
    startGoogleLogin,
    startOpenRouterBrowserLogin,
    openLoginPicker
  } = useLoginFlows({ session, setOverlay, addNote });

  // Фоновая загрузка метаданных при старте
  useEffect(() => {
    if (!session.apiKey) {
      openLoginPicker();
    }
    listModels(loadConfig()).catch(() => {});
    getModelContextLength(session.model, session.provider, session.apiKey)
      .then(len => {
        session.contextLength = len;
      })
      .catch(() => {});

    if (session.apiKey) {
      fetchKeyInfo(session.apiKey, session.provider)
        .then(info => {
          if (info) session.keyInfo = info;
        })
        .catch(() => {});
    }
  }, [session, openLoginPicker]);

  useResizeRedraw(setStaticKey);

  const {
    status,
    phase,
    startedAt,
    queued,
    queueRef,
    setQueued,
    handleSend,
    abort
  } = useAgentTurn({
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
    handleCommand: (cmd) => handleCommandRef.current(cmd)
  });

  const { handleCommand } = useCommands({
    session,
    app,
    setTranscript,
    addNote,
    setOverlay,
    setStaticKey,
    queueRef,
    setQueued,
    toolCtxRef,
    startGoogleLogin,
    startOpenRouterBrowserLogin,
    openLoginPicker
  });
  handleCommandRef.current = handleCommand;

  const cancelOverlay = useCallback(() => {
    if (!overlay) return false;
    if (typeof overlay.cancel === 'function') overlay.cancel();
    if (typeof overlay.onCancel === 'function') overlay.onCancel();
    if (typeof overlay.onResolve === 'function') overlay.onResolve('no');
    setOverlay(null);
    return true;
  }, [overlay]);

  // Глобальный перехват клавиатуры (Ctrl+C, Esc)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'working') {
        cancelOverlay();
        abort();
        return;
      }
      if (cancelOverlay()) {
        return;
      }
      const now = Date.now();
      if (now - lastSigintRef.current < 2500) {
        app.exit();
      } else {
        lastSigintRef.current = now;
        addNote('warn', 'Нажмите Ctrl+C ещё раз для выхода');
      }
      return;
    }

    if (key.escape && status === 'working') {
      abort();
    }
  });

  return h(
    Box,
    { flexDirection: 'column', width: '100%' },
    h(Transcript, { items: transcript, session, staticKey }),
    h(LiveOutput, { liveTools, liveText }),
    h(Overlay, { overlay }),
    h(InputBox, {
      busy: status === 'working',
      queued,
      draft: draft.text,
      draftKey: draft.key,
      overlayOpen: Boolean(overlay),
      imagesSupported: findModel(session.model)?.vision !== false,
      onSend: handleSend
    }),
    h(StatusBar, {
      status,
      session,
      phase,
      startedAt,
      getLastActivity: () => lastActivityRef.current,
      queuedCount: queued.length,
      waitingForUser: overlay?.kind === 'approval'
    })
  );
}
