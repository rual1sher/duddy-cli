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
import { listModels, findModel, UNAVAILABLE_REASONS, clearModelBusy } from '../catalog.js';
import { loadConfig } from '../config.js';
import { detectProviderForModel, getProviderKey } from '../providers.js';
import { fetchKeyInfo, getModelContextLength } from '../api.js';
import { startBrowserLogin, openBrowser } from '../auth.js';
import { buildUserContent } from '../images.js';
import { describeToolStart } from '../toolDisplay.js';

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
  const [queued, setQueued] = useState([]);
  const [draft, setDraft] = useState({ text: '', key: 0 });

  const liveToolsRef = useRef([]);
  const liveTextBufferRef = useRef('');
  const liveTextTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lastSigintRef = useRef(0);
  const modelLabelRef = useRef('');
  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const changesRef = useRef(new Map());
  const sendRef = useRef(null);
  const lastActivityRef = useRef(0);

  const toolCtxRef = useRef({
    autoApprove: Boolean(session.autoApprove),
    canPrompt: true,
    log: (level, text) => {
      const prev = liveToolsRef.current;
      if (prev.length === 0) return;
      const last = prev[prev.length - 1];
      const updated = {
        ...last,
        logs: [...(last.logs || []), { level, text }]
      };
      const next = [...prev.slice(0, -1), updated];
      liveToolsRef.current = next;
      setLiveTools(next);
    },
    approve: ({ name, relPath, preview }) => {
      return new Promise((resolve) => {
        setOverlay({
          kind: 'approval',
          name,
          relPath,
          preview,
          onResolve: (choice) => {
            lastActivityRef.current = Date.now();
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
  }, [flushLiveText]);

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
        queueRef.current = [];
        setQueued([]);
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

        const items = allModels.map(m => {
          const disabled = Boolean(m.unavailable);
          const busy = Boolean(m.busy);
          let reason;
          if (disabled) {
            reason = UNAVAILABLE_REASONS[m.unavailable];
          } else if (busy) {
            reason = 'перегружена сейчас — попробуйте позже';
          }
          return {
            label: m.name,
            hint: m.id,
            value: { id: m.id, provider: m.provider },
            current: m.id === session.model,
            group: hasBoth ? (m.provider === 'google' ? 'Google' : 'OpenRouter') : undefined,
            disabled,
            busy,
            reason
          };
        });

        setOverlay({
          kind: 'picker',
          title: `Выбор модели · доступно ${items.filter(it => !it.disabled).length} из ${items.length}`,
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

  const handleSend = async (userText, images = []) => {
    const trimmed = userText.trim();
    if (!trimmed) return;

    if (busyRef.current) {
      if (trimmed.startsWith('/')) {
        setTranscript(prev => [
          ...prev,
          {
            type: 'note',
            level: 'warn',
            text: 'Команды недоступны во время ответа — дождитесь завершения или нажмите Esc'
          }
        ]);
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
        events: {
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
        }
      });

      commitTurn(session, content, newMessages, finalText);
      succeeded = true;
      clearModelBusy(session.provider, session.model);

      const turnElapsed = elapsedMs ?? (Date.now() - startMs);
      session.lastTurnMs = turnElapsed;
      if (lastUsage) {
        session.lastUsage = lastUsage;
      }

      const totalTok = lastUsage?.total_tokens || 0;
      const tokFormatted = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k` : `${totalTok}`;
      const tokInfo = totalTok ? ` · ${tokFormatted} tok` : '';

      const created = [];
      const modified = [];
      const deleted = [];
      for (const [p, ch] of changesRef.current.entries()) {
        if (ch === 'created') created.push(p);
        else if (ch === 'modified') modified.push(p);
        else if (ch === 'deleted') deleted.push(p);
      }
      const changes = { created, modified, deleted };

      setTranscript(prev => [
        ...prev,
        {
          type: 'done',
          text: `✔ ${formatDuration(turnElapsed)}${tokInfo}`,
          changes
        }
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
              h(Text, { bold: true, color: '#f8fafc' }, tool.display?.title || tool.name),
              tool.target ? h(Text, { color: '#94a3b8' }, ` ${tool.target}`) : null,
              h(Text, { color: '#94a3b8' }, '…')
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

  if (liveText.trim()) {
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
