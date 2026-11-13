/**
 * @fileoverview Корневой компонент TUI-интерфейса Duddy (Ink)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, useApp, useInput, useWindowSize, measureElement } from 'ink';
import { Transcript } from './Transcript.js';
import { StatusBar } from './StatusBar.js';
import { InputBox } from './InputBox.js';
import { LiveOutput } from './LiveOutput.js';
import { Overlay } from './Overlay.js';
import { WorkingIndicator } from './WorkingIndicator.js';
import { useLiveOutput } from './hooks/useLiveOutput.js';
import { useToolContext } from './hooks/useToolContext.js';
import { useLoginFlows } from './hooks/useLoginFlows.js';
import { useResizeRedraw } from './hooks/useResizeRedraw.js';
import { useCommands } from './hooks/useCommands.js';
import { openThemePicker } from './commands/themeCommand.js';
import { useAgentTurn } from './hooks/useAgentTurn.js';
import { listModels, findModel } from '../models/catalog.js';
import { loadConfig } from '../config.js';
import { fetchKeyInfo, getModelContextLength } from '../llm/modelInfo.js';
import { nextMode } from '../modes.js';
import { checkForUpdate, updateMessage } from '../update.js';
import { commandsFor } from '../commands.js';
import { warmupLocalModel } from '../llm/warmup.js';
import { getProvider } from '../providers.js';

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
  // staticKey, при котором история перестала помещаться на экран и ушла в Static.
  // /clear, смена темы и ресайз меняют staticKey и тем самым возвращают историю наверх экрана.
  const [flushedKey, setFlushedKey] = useState(-1);
  const flushed = flushedKey === staticKey;
  const { rows } = useWindowSize();
  const contentRef = useRef(null);
  const contentInnerRef = useRef(null);
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

  const { toolCtxRef, mode, setMode } = useToolContext({
    session,
    liveToolsRef,
    setLiveTools,
    setOverlay,
    lastActivityRef
  });

  const {
    startOpenRouterBrowserLogin,
    openLoginPicker
  } = useLoginFlows({ session, setOverlay, addNote });

  // Фоновая загрузка метаданных при старте
  useEffect(() => {
    if (getProvider(session?.provider)?.local) {
      warmupLocalModel(session, { mode });
    }
    if (!loadConfig().theme) {
      openThemePicker(
        { setOverlay, setStaticKey, addNote },
        {
          onDone: () => {
            if (!session.apiKey && session.provider !== 'ollama') openLoginPicker();
          }
        }
      );
    } else if (!session.apiKey && session.provider !== 'ollama') {
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

    checkForUpdate(session?.version)
      .then(info => {
        if (info) {
          const m = updateMessage(info);
          addNote(m.level, m.text);
        }
      })
      .catch(() => {});
  }, [session, openLoginPicker, addNote]);

  useResizeRedraw(setStaticKey);

  // Layout уже посчитан к моменту эффекта: если история с живым выводом не влезает
  // над полем ввода, переносим её в Static и дальше экран прокручивается как обычно.
  useEffect(() => {
    if (flushed || !contentRef.current || !contentInnerRef.current) return;
    const available = measureElement(contentRef.current).height;
    const needed = measureElement(contentInnerRef.current).height;
    if (needed > available) {
      setFlushedKey(staticKey);
    }
  });

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
    mode,
    app,
    setTranscript,
    addNote,
    setOverlay,
    setStaticKey,
    queueRef,
    setQueued,
    toolCtxRef,
    startOpenRouterBrowserLogin,
    openLoginPicker,
    handleSend,
    setDraft
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

  // Глобальный перехват клавиатуры (Ctrl+C, Esc, Shift+Tab)
  useInput((input, key) => {
    if (key.tab && key.shift && !overlay) {
      setMode(nextMode(mode));
      return;
    }

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

  // До переноса в Static кадр занимает экран целиком (кроме строки под курсор Ink):
  // история сверху, поле ввода и статус снизу. Обрезка лишнего держит кадр в пределах
  // экрана в тот единственный кадр, пока эффект выше не перенесёт историю в Static.
  return h(
    Box,
    { flexDirection: 'column', width: '100%', height: flushed ? undefined : Math.max(1, rows - 1) },
    h(
      Box,
      {
        ref: contentRef,
        flexDirection: 'column',
        flexGrow: flushed ? 0 : 1,
        flexShrink: flushed ? 0 : 1,
        overflow: flushed ? 'visible' : 'hidden'
      },
      h(
        Box,
        { ref: contentInnerRef, flexDirection: 'column', flexShrink: 0 },
        h(Transcript, { items: transcript, session, staticKey, flushed }),
        h(LiveOutput, { liveTools, liveText }),
        h(WorkingIndicator, {
          status,
          phase,
          startedAt,
          getLastActivity: () => lastActivityRef.current,
          waitingForUser: overlay?.kind === 'approval'
        }),
        h(Overlay, { overlay })
      )
    ),
    h(
      Box,
      { flexDirection: 'column', flexShrink: 0 },
      h(InputBox, {
        busy: status === 'working',
        queued,
        draft: draft.text,
        draftKey: draft.key,
        overlayOpen: Boolean(overlay),
        imagesSupported: findModel(session.model)?.vision !== false,
        commands: commandsFor(session),
        onSend: handleSend
      }),
      h(StatusBar, {
        status,
        session,
        queuedCount: queued.length,
        waitingForUser: overlay?.kind === 'approval',
        mode
      })
    )
  );
}
