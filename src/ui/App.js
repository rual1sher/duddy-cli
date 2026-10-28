/**
 * @fileoverview Корневой компонент TUI-интерфейса Duddy (Ink)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Transcript } from './Transcript.js';
import { StatusBar } from './StatusBar.js';
import { InputBox } from './InputBox.js';
import { Picker } from './Picker.js';
import { SecretInput } from './SecretInput.js';
import { Approval } from './Approval.js';
import { BrowserLogin } from './BrowserLogin.js';
import { runAgentTurn } from '../agent.js';
import { renderMarkdown, formatDuration } from '../formatter.js';
import { commitTurn } from '../history.js';
import { handleModelError, errorText } from '../errors.js';
import {
  AVAILABLE_COMMANDS,
  selectModel,
  setEffort,
  saveOpenRouterKey,
  connectGoogle,
  usageLines,
  helpLines
} from '../session-actions.js';
import { listModels, UNAVAILABLE_REASONS } from '../catalog.js';
import { loadConfig } from '../config.js';
import { detectProviderForModel, getProviderKey } from '../providers.js';
import { fetchKeyInfo, getModelContextLength } from '../api.js';
import { startBrowserLogin, openBrowser } from '../auth.js';

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

  const [status, setStatus] = useState('idle');
  const [phase, setPhase] = useState('thinking');
  const [startedAt, setStartedAt] = useState(null);

  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState([]);

  const [overlay, setOverlay] = useState(null);

  const liveTextBufferRef = useRef('');
  const liveTextTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lastSigintRef = useRef(0);
  const modelLabelRef = useRef('');

  const toolCtxRef = useRef({
    autoApprove: Boolean(session.autoApprove),
    canPrompt: true,
    log: (level, text) => {
      setLiveTools(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const updated = {
          ...last,
          logs: [...(last.logs || []), { level, text }]
        };
        return [...prev.slice(0, -1), updated];
      });
    },
    approve: ({ name, relPath, preview }) => {
      return new Promise((resolve) => {
        setOverlay({
          kind: 'approval',
          name,
          relPath,
          preview,
          onResolve: (choice) => {
            setOverlay(null);
            if (choice === 'all') {
              toolCtxRef.current.autoApprove = true;
            }
            resolve(choice);
          }
        });
      });
    }
  });

  session.toolCtx = toolCtxRef.current;

  const flushLiveText = useCallback(() => {
    if (liveTextTimerRef.current) {
      clearTimeout(liveTextTimerRef.current);
      liveTextTimerRef.current = null;
    }
    setLiveText(liveTextBufferRef.current);
  }, []);

  const queueLiveText = useCallback((delta) => {
    liveTextBufferRef.current += delta;
    if (!liveTextTimerRef.current) {
      liveTextTimerRef.current = setTimeout(() => {
        liveTextTimerRef.current = null;
        setLiveText(liveTextBufferRef.current);
      }, 50);
    }
  }, []);

  // --- Авторизационные сценарии ---

  const startGoogleLogin = useCallback((onSuccess) => {
    openBrowser('https://aistudio.google.com/apikey');
    setTranscript(prev => [
      ...prev,
      {
        type: 'note',
        level: 'info',
        text: 'Откройте aistudio.google.com/apikey, создайте ключ и вставьте его'
      }
    ]);
    setOverlay({
      kind: 'secret',
      title: 'API-ключ Google AI Studio',
      onSubmit: async (key) => {
        setOverlay({ kind: 'loading', text: 'Проверка ключа…' });
        try {
          const msg = await connectGoogle(session, key);
          setTranscript(prev => [...prev, { type: 'note', level: 'success', text: msg }]);
          if (typeof onSuccess === 'function') {
            await onSuccess();
          }
        } catch (err) {
          setTranscript(prev => [...prev, { type: 'note', level: 'error', text: err.message }]);
        } finally {
          setOverlay(null);
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [session]);

  const startOpenRouterBrowserLogin = useCallback((onSuccess) => {
    const { url, result, cancel } = startBrowserLogin();
    setOverlay({
      kind: 'browser',
      url,
      cancel: () => {
        cancel();
        setOverlay(null);
        setTranscript(prev => [...prev, { type: 'note', level: 'info', text: 'Вход отменён' }]);
      }
    });
    result.then(async (key) => {
      setOverlay(null);
      if (key) {
        const msg = saveOpenRouterKey(session, key);
        setTranscript(prev => [...prev, { type: 'note', level: 'success', text: msg }]);
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
      } else {
        setTranscript(prev => [...prev, { type: 'note', level: 'info', text: 'Вход отменён' }]);
      }
    });
  }, [session]);

  const startOpenRouterManualLogin = useCallback((onSuccess) => {
    setOverlay({
      kind: 'secret',
      title: 'API-ключ OpenRouter (sk-or-...)',
      onSubmit: async (key) => {
        setOverlay(null);
        const msg = saveOpenRouterKey(session, key);
        setTranscript(prev => [...prev, { type: 'note', level: 'success', text: msg }]);
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [session]);

  const openLoginPicker = useCallback((onSuccess) => {
    setOverlay({
      kind: 'picker',
      title: 'Авторизация в провайдерах',
      searchable: false,
      items: [
        { label: 'OpenRouter — войти через браузер', hint: 'OAuth', value: 'openrouter_browser' },
        { label: 'OpenRouter — вставить ключ', hint: 'sk-or-...', value: 'openrouter_manual' },
        { label: 'Google AI Studio — вставить ключ', hint: 'Gemini API', value: 'google' }
      ],
      onSelect: (choice) => {
        setOverlay(null);
        if (choice === 'openrouter_browser') {
          startOpenRouterBrowserLogin(onSuccess);
        } else if (choice === 'openrouter_manual') {
          startOpenRouterManualLogin(onSuccess);
        } else if (choice === 'google') {
          startGoogleLogin(onSuccess);
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [startGoogleLogin, startOpenRouterBrowserLogin, startOpenRouterManualLogin]);

  // Фоновая загрузка метаданных при старте
  useEffect(() => {
    if (!session.apiKey) {
      openLoginPicker();
    }
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

  // Глобальный перехват клавиатуры (Ctrl+C, Esc)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'working') {
        if (overlay) {
          if (typeof overlay.cancel === 'function') overlay.cancel();
          if (typeof overlay.onCancel === 'function') overlay.onCancel();
          if (typeof overlay.onResolve === 'function') overlay.onResolve('no');
          setOverlay(null);
        }
        abortControllerRef.current?.abort();
        return;
      }
      if (overlay) {
        if (typeof overlay.cancel === 'function') overlay.cancel();
        if (typeof overlay.onCancel === 'function') overlay.onCancel();
        if (typeof overlay.onResolve === 'function') overlay.onResolve('no');
        setOverlay(null);
        return;
      }
      const now = Date.now();
      if (now - lastSigintRef.current < 2500) {
        app.exit();
      } else {
        lastSigintRef.current = now;
        setTranscript(prev => [
          ...prev,
          {
            type: 'note',
            level: 'warn',
            text: 'Нажмите Ctrl+C ещё раз для выхода'
          }
        ]);
      }
      return;
    }

    if (key.escape && status === 'working') {
      abortControllerRef.current?.abort();
    }
  });

  // --- Обработчики команд ---

  const handleCommand = async (rawCmd) => {
    const [name, ...rest] = rawCmd.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    const cmd = name.toLowerCase();

    // Алиасы
    let normalized = cmd;
    if (cmd === 'm' || cmd === 'models') normalized = 'model';
    else if (cmd === 'think') normalized = 'effort';
    else if (cmd === 'auth' || cmd === 'key') normalized = 'login';
    else if (cmd === 'cls' || cmd === 'reset') normalized = 'clear';
    else if (cmd === 'stats') normalized = 'usage';
    else if (cmd === '?' || cmd === '') normalized = 'help';
    else if (cmd === 'quit' || cmd === 'q') normalized = 'exit';

    switch (normalized) {
      case 'exit':
        app.exit();
        return;

      case 'help': {
        const lines = helpLines();
        setTranscript(prev => [...prev, { type: 'lines', lines }]);
        return;
      }

      case 'clear':
        session.messages = [];
        session.lastRoutedModel = '';
        toolCtxRef.current.autoApprove = Boolean(session.autoApprove);
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        setTranscript([
          { type: 'banner' },
          { type: 'note', level: 'success', text: 'Новый диалог' }
        ]);
        setStaticKey(k => k + 1);
        return;

      case 'usage': {
        const lines = await usageLines(session);
        setTranscript(prev => [...prev, { type: 'lines', lines }]);
        return;
      }

      case 'effort': {
        if (arg) {
          const msg = setEffort(session, arg);
          const isErr = msg.startsWith('Неизвестный');
          setTranscript(prev => [
            ...prev,
            { type: 'note', level: isErr ? 'warn' : 'success', text: msg }
          ]);
          return;
        }
        setOverlay({
          kind: 'picker',
          title: 'Уровень рассуждений (reasoning effort)',
          searchable: false,
          items: [
            { label: 'auto', hint: 'по умолчанию модели', value: 'auto', current: (session.reasoningEffort || 'auto') === 'auto' },
            { label: 'low', hint: 'быстрее', value: 'low', current: session.reasoningEffort === 'low' },
            { label: 'medium', hint: 'баланс', value: 'medium', current: session.reasoningEffort === 'medium' },
            { label: 'high', hint: 'качественнее, медленнее', value: 'high', current: session.reasoningEffort === 'high' }
          ],
          onSelect: (val) => {
            setOverlay(null);
            const msg = setEffort(session, val);
            setTranscript(prev => [...prev, { type: 'note', level: 'success', text: msg }]);
          },
          onCancel: () => setOverlay(null)
        });
        return;
      }

      case 'login': {
        if (arg) {
          const lower = arg.toLowerCase();
          if (lower === 'google' || lower === 'gemini' || lower === 'aistudio') {
            startGoogleLogin();
            return;
          }
          if (lower === 'browser' || lower === 'web') {
            startOpenRouterBrowserLogin();
            return;
          }
          if (arg.startsWith('sk-or-')) {
            const msg = saveOpenRouterKey(session, arg);
            setTranscript(prev => [...prev, { type: 'note', level: 'success', text: msg }]);
            return;
          }
        }
        openLoginPicker();
        return;
      }

      case 'model': {
        if (arg) {
          const provId = detectProviderForModel(arg);
          const res = await selectModel(session, arg, provId);
          if (res.needsLogin) {
            if (res.needsLogin === 'google') {
              startGoogleLogin(async () => {
                const retry = await selectModel(session, arg, 'google');
                if (retry.ok) {
                  setTranscript(prev => [...prev, { type: 'note', level: 'success', text: retry.message }]);
                }
              });
            } else {
              openLoginPicker(async () => {
                const retry = await selectModel(session, arg, 'openrouter');
                if (retry.ok) {
                  setTranscript(prev => [...prev, { type: 'note', level: 'success', text: retry.message }]);
                }
              });
            }
            return;
          }
          if (res.ok) {
            setTranscript(prev => [...prev, { type: 'note', level: 'success', text: res.message }]);
          } else {
            setTranscript(prev => [...prev, { type: 'note', level: 'warn', text: res.message }]);
          }
          return;
        }

        setOverlay({ kind: 'loading', text: 'Загрузка моделей…' });
        let models = [];
        try {
          models = await listModels(loadConfig());
        } catch {
          models = [];
        }

        if (!models || models.length === 0) {
          setOverlay(null);
          setTranscript(prev => [
            ...prev,
            { type: 'note', level: 'info', text: 'Нет доступных моделей — выполните /login' }
          ]);
          return;
        }

        const cfg = loadConfig();
        const hasBoth = Boolean(getProviderKey('google', cfg) && getProviderKey('openrouter', cfg));

        const cur = models.find(m => m.id === session.model);
        const allModels = cur
          ? models
          : [
              {
                id: session.model,
                name: session.model,
                provider: session.provider || detectProviderForModel(session.model)
              },
              ...models
            ];

        const items = allModels.map(m => ({
          label: m.name,
          hint: m.id,
          value: { id: m.id, provider: m.provider },
          current: m.id === session.model,
          group: hasBoth ? (m.provider === 'google' ? 'Google' : 'OpenRouter') : undefined,
          disabled: Boolean(m.unavailable),
          reason: m.unavailable ? UNAVAILABLE_REASONS[m.unavailable] : undefined
        }));

        setOverlay({
          kind: 'picker',
          title: 'Выбор модели',
          items,
          searchable: true,
          initialValue: session.model,
          onSelect: async (val) => {
            setOverlay(null);
            const res = await selectModel(session, val.id, val.provider);
            if (res.needsLogin) {
              if (res.needsLogin === 'google') {
                startGoogleLogin(async () => {
                  const retry = await selectModel(session, val.id, 'google');
                  if (retry.ok) {
                    setTranscript(prev => [...prev, { type: 'note', level: 'success', text: retry.message }]);
                  }
                });
              } else {
                openLoginPicker(async () => {
                  const retry = await selectModel(session, val.id, 'openrouter');
                  if (retry.ok) {
                    setTranscript(prev => [...prev, { type: 'note', level: 'success', text: retry.message }]);
                  }
                });
              }
              return;
            }
            if (res.ok) {
              setTranscript(prev => [...prev, { type: 'note', level: 'success', text: res.message }]);
            } else {
              setTranscript(prev => [...prev, { type: 'note', level: 'warn', text: res.message }]);
            }
          },
          onCancel: () => setOverlay(null)
        });
        return;
      }

      default: {
        setTranscript(prev => [
          ...prev,
          {
            type: 'note',
            level: 'warn',
            text: `Неизвестная команда /${cmd} — введите / для списка`
          }
        ]);
      }
    }
  };

  // --- Основной агентный цикл отправки сообщений ---

  const handleSend = async (userText) => {
    const trimmed = userText.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      return;
    }

    setTranscript(prev => [...prev, { type: 'user', text: trimmed }]);
    setStatus('working');
    setPhase('thinking');
    const startMs = Date.now();
    setStartedAt(startMs);

    abortControllerRef.current = new AbortController();
    modelLabelRef.current = session.model;
    liveTextBufferRef.current = '';

    const messagesToSend = [
      { role: 'system', content: session.systemPrompt },
      ...(session.messages || []),
      { role: 'user', content: trimmed }
    ];

    try {
      const { finalText, newMessages, lastUsage, elapsedMs } = await runAgentTurn({
        session,
        messages: messagesToSend,
        toolCtx: toolCtxRef.current,
        signal: abortControllerRef.current.signal,
        events: {
          onPhase: (p) => setPhase(p),
          onModel: (id) => {
            if (id && id !== session.model) {
              modelLabelRef.current = `${session.model} → ${id}`;
            }
          },
          onText: (delta) => queueLiveText(delta),
          onStepEnd: async () => {
            flushLiveText();
            if (liveTextBufferRef.current) {
              const rendered = renderMarkdown(liveTextBufferRef.current);
              setTranscript(prev => [
                ...prev,
                { type: 'assistant', lines: rendered, label: modelLabelRef.current }
              ]);
              liveTextBufferRef.current = '';
              setLiveText('');
            }
          },
          onToolStart: ({ id, name, args }) => {
            const target = args?.path ?? '';
            setLiveTools(prev => [...prev, { id, name, target, logs: [] }]);
          },
          onToolResult: ({ id, name, ok, summary }) => {
            setLiveTools(prev => {
              const item = prev.find(t => t.id === id) || { id, name, target: '', logs: [] };
              const toolResultItem = {
                type: 'tool',
                name: item.name || name,
                target: item.target,
                ok,
                summary,
                logs: item.logs || []
              };
              setTranscript(tPrev => [...tPrev, toolResultItem]);
              return prev.filter(t => t.id !== id);
            });
          },
          onWarning: (msg) => {
            setTranscript(prev => [...prev, { type: 'note', level: 'warn', text: msg }]);
          }
        }
      });

      commitTurn(session, trimmed, newMessages, finalText);

      const turnElapsed = elapsedMs ?? (Date.now() - startMs);
      session.lastTurnMs = turnElapsed;
      if (lastUsage) {
        session.lastUsage = lastUsage;
      }

      const totalTok = lastUsage?.total_tokens || 0;
      const tokFormatted = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k` : `${totalTok}`;
      const tokInfo = totalTok ? ` · ${tokFormatted} tok` : '';
      setTranscript(prev => [
        ...prev,
        { type: 'done', text: `✔ ${formatDuration(turnElapsed)}${tokInfo}` }
      ]);

      if (session.apiKey) {
        fetchKeyInfo(session.apiKey, session.provider)
          .then(info => {
            if (info) session.keyInfo = info;
          })
          .catch(() => {});
      }
    } catch (err) {
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
            hint
          }
        ]);
      }
    } finally {
      flushLiveText();
      if (liveTextBufferRef.current) {
        const rendered = renderMarkdown(liveTextBufferRef.current);
        setTranscript(prev => [
          ...prev,
          { type: 'assistant', lines: rendered, label: modelLabelRef.current }
        ]);
        liveTextBufferRef.current = '';
      }
      setLiveText('');
      setLiveTools([]);
      setStatus('idle');
      setPhase('thinking');
      setStartedAt(null);
    }
  };

  // --- Рендеринг интерфейса ---

  let overlayElement = null;
  if (overlay) {
    if (overlay.kind === 'picker') {
      overlayElement = h(Picker, overlay);
    } else if (overlay.kind === 'secret') {
      overlayElement = h(SecretInput, overlay);
    } else if (overlay.kind === 'approval') {
      overlayElement = h(Approval, overlay);
    } else if (overlay.kind === 'browser') {
      overlayElement = h(BrowserLogin, overlay);
    } else if (overlay.kind === 'loading') {
      overlayElement = h(
        Box,
        {
          borderStyle: 'round',
          borderColor: '#334155',
          paddingX: 1,
          flexDirection: 'row',
          width: '100%'
        },
        h(Text, { color: '#38bdf8' }, '⠋ '),
        h(Text, { color: '#f8fafc' }, overlay.text)
      );
    }
  }

  const liveElements = [];

  if (liveTools.length > 0) {
    liveElements.push(
      h(
        Box,
        { key: 'live-tools', flexDirection: 'column' },
        liveTools.map(tool => {
          const filteredLogs = (tool.logs || []).filter(
            l => l && (l.level === 'error' || l.level === 'warn')
          );
          return h(
            Box,
            { key: tool.id, flexDirection: 'column' },
            h(
              Box,
              { flexDirection: 'row' },
              h(Text, { color: '#38bdf8' }, '⏺ '),
              h(Text, { bold: true, color: '#f8fafc' }, tool.name),
              tool.target ? h(Text, { color: '#94a3b8' }, `(${tool.target})`) : null
            ),
            filteredLogs.map((log, i) =>
              h(
                Text,
                { key: i, color: log.level === 'error' ? '#ef4444' : '#f59e0b' },
                `    ${log.text}`
              )
            )
          );
        })
      )
    );
  }

  if (liveText) {
    const liveLines = renderMarkdown(liveText);
    liveElements.push(
      h(
        Box,
        { key: 'live-text', marginTop: 1, flexDirection: 'column' },
        liveLines.map((line, i) =>
          h(
            Box,
            { key: i, flexDirection: 'row' },
            i === 0
              ? h(Text, { color: '#38bdf8' }, '⏺ ')
              : h(Text, null, '  '),
            h(Text, null, line)
          )
        )
      )
    );
  }

  return h(
    Box,
    { flexDirection: 'column', width: '100%' },
    h(Transcript, { items: transcript, session, staticKey }),
    liveElements.length > 0
      ? h(Box, { flexDirection: 'column' }, liveElements)
      : null,
    overlayElement,
    h(InputBox, {
      disabled: status === 'working',
      overlayOpen: Boolean(overlay),
      onSend: handleSend
    }),
    h(StatusBar, {
      status,
      session,
      phase,
      startedAt,
      hasLiveText: Boolean(liveText)
    })
  );
}
