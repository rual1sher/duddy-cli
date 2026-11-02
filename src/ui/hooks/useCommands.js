/**
 * @fileoverview Обработка слэш-команд пользовательского интерфейса Duddy
 */

import { useCallback } from 'react';
import fs from 'node:fs';
import {
  selectModel,
  setEffort,
  saveOpenRouterKey,
  usageLines,
  contextLines,
  helpLines
} from '../../session-actions.js';
import { listModels } from '../../models/catalog.js';
import { UNAVAILABLE_REASONS } from '../../models/status.js';
import { loadConfig } from '../../config.js';
import { PROVIDERS, getProvider, detectProviderForModel, getProviderKey } from '../../providers.js';
import { CLEAR_SCREEN } from './useResizeRedraw.js';
import { undoLastCheckpoint } from '../../tools/checkpoints.js';

const COMMAND_ALIASES = {
  ctx: 'context',
  m: 'model',
  models: 'model',
  think: 'effort',
  auth: 'login',
  key: 'login',
  cls: 'clear',
  reset: 'clear',
  stats: 'usage',
  '?': 'help',
  '': 'help',
  quit: 'exit',
  q: 'exit'
};

/**
 * Применяет выбор модели с повторной попыткой после авторизации при необходимости
 */
async function applyModelChoice(id, provider, { session, addNote, startGoogleLogin, startXaiLogin, openLoginPicker }) {
  const res = await selectModel(session, id, provider);
  if (res.needsLogin) {
    const startLogin = res.needsLogin === 'google'
      ? startGoogleLogin
      : res.needsLogin === 'xai'
        ? startXaiLogin
        : openLoginPicker;
    startLogin(async () => {
      const retry = await selectModel(session, id, res.needsLogin);
      if (retry.ok) {
        addNote('success', retry.message);
      }
    });
    return;
  }
  if (res.ok) {
    addNote('success', res.message);
  } else {
    addNote('warn', res.message);
  }
}

/**
 * Выводит справочный экран по командам
 */
function showHelp({ setTranscript }) {
  const lines = helpLines();
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Очищает историю сообщений диалога и перезапускает экран
 */
function clearConversation({ session, queueRef, setQueued, toolCtxRef, setTranscript, setStaticKey }) {
  queueRef.current = [];
  setQueued([]);
  session.messages = [];
  session.lastRoutedModel = '';
  session.lastUsage = null;
  toolCtxRef.current.autoApprove = Boolean(session.autoApprove);
  toolCtxRef.current.allowedCommands = new Set();
  process.stdout.write(CLEAR_SCREEN);
  setTranscript([
    { type: 'banner' },
    { type: 'note', level: 'success', text: 'Новый диалог' }
  ]);
  setStaticKey(k => k + 1);
}

/**
 * Выводит статистику расхода токенов и лимитов
 */
async function showUsage({ session, setTranscript }) {
  const lines = await usageLines(session);
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Выводит информацию об окне контекста и истории сообщений
 */
async function showContext({ session, setTranscript }) {
  const lines = await contextLines(session);
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Изменяет уровень рассуждений (reasoning effort)
 */
function changeEffort(arg, { session, setOverlay, addNote }) {
  if (arg) {
    const msg = setEffort(session, arg);
    const isErr = msg.startsWith('Неизвестный');
    addNote(isErr ? 'warn' : 'success', msg);
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
      addNote('success', msg);
    },
    onCancel: () => setOverlay(null)
  });
}

/**
 * Выполняет сценарий входа в провайдер
 */
function login(arg, { session, addNote, startGoogleLogin, startXaiLogin, startOpenRouterBrowserLogin, openLoginPicker }) {
  if (arg) {
    const lower = arg.toLowerCase();
    if (lower === 'google' || lower === 'gemini' || lower === 'aistudio') {
      startGoogleLogin();
      return;
    }
    if (lower === 'xai' || lower === 'grok') {
      startXaiLogin();
      return;
    }
    if (lower === 'browser' || lower === 'web') {
      startOpenRouterBrowserLogin();
      return;
    }
    if (arg.startsWith('sk-or-')) {
      const msg = saveOpenRouterKey(session, arg);
      addNote('success', msg);
      return;
    }
  }
  openLoginPicker();
}

/**
 * Переключает модель по указанному идентификатору
 */
async function changeModel(arg, ctx) {
  const provId = detectProviderForModel(arg);
  await applyModelChoice(arg, provId, ctx);
}

/**
 * Открывает интерактивное меню выбора модели
 */
async function pickModel(ctx) {
  const { session, setOverlay, addNote } = ctx;
  setOverlay({ kind: 'loading', text: 'Загрузка моделей…' });
  let models = [];
  try {
    models = await listModels(loadConfig());
  } catch {
    models = [];
  }

  if (!models || models.length === 0) {
    setOverlay(null);
    addNote('info', 'Нет доступных моделей — выполните /login');
    return;
  }

  const cfg = loadConfig();
  const connected = Object.keys(PROVIDERS).filter(id => getProviderKey(id, cfg));

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
      group: connected.length > 1 ? getProvider(m.provider).title : undefined,
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
      await applyModelChoice(val.id, val.provider, ctx);
    },
    onCancel: () => setOverlay(null)
  });
}

/**
 * Отменяет изменения файлов последнего хода агента через /undo
 */
async function undoLastTurn({ session, addNote }) {
  const result = await undoLastCheckpoint(fs.realpathSync(process.cwd()));
  if (!result) {
    addNote('info', 'Нечего отменять');
    return;
  }
  const { restored, conflicts, backupDir } = result;
  if (restored.length > 0) {
    const list = restored.join(', ');
    addNote('success', `Восстановлено: ${list}`);
    session.messages = [
      ...(session.messages || []),
      { role: 'user', content: `Я отменил изменения файлов: ${list}` },
      { role: 'assistant', content: 'Понял, изменения отменены.' }
    ];
  }
  if (conflicts.length > 0) {
    addNote('warn', `Изменены после хода, не тронуты: ${conflicts.join(', ')}. Копии лежат в ${backupDir}`);
  }
}

/**
 * Хук обработки слэш-команд
 *
 * @param {object} params
 * @returns {{ handleCommand: Function }}
 */
export function useCommands({
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
  startXaiLogin,
  startOpenRouterBrowserLogin,
  openLoginPicker
}) {
  const handleCommand = useCallback(async (rawCmd) => {
    const [name, ...rest] = rawCmd.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    const cmd = name.toLowerCase();
    const normalized = COMMAND_ALIASES[cmd] ?? cmd;

    const ctx = {
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
      startXaiLogin,
      startOpenRouterBrowserLogin,
      openLoginPicker
    };

    switch (normalized) {
      case 'exit':
        app.exit();
        return;

      case 'help':
        showHelp(ctx);
        return;

      case 'clear':
        clearConversation(ctx);
        return;

      case 'context':
        await showContext(ctx);
        return;

      case 'usage':
        await showUsage(ctx);
        return;

      case 'undo':
        await undoLastTurn(ctx);
        return;

      case 'effort':
        changeEffort(arg, ctx);
        return;

      case 'login':
        login(arg, ctx);
        return;

      case 'model':
        if (arg) {
          await changeModel(arg, ctx);
        } else {
          await pickModel(ctx);
        }
        return;

      default:
        addNote('warn', `Неизвестная команда /${cmd} — введите / для списка`);
    }
  }, [
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
    startXaiLogin,
    startOpenRouterBrowserLogin,
    openLoginPicker
  ]);

  return { handleCommand };
}
