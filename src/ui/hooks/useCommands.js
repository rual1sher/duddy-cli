/**
 * @fileoverview Обработка слэш-команд пользовательского интерфейса Duddy
 */

import React, { useCallback } from 'react';
import {
  selectModel,
  setEffort,
  saveOpenRouterKey,
  connectOllama,
  usageLines,
  contextLines,
  helpLines
} from '../../session-actions.js';
import { listModels, findModel, clearCatalogCache } from '../../models/catalog.js';
import { checkOllamaServer } from '../../models/ollama.js';
import { UNAVAILABLE_REASONS } from '../../models/status.js';
import { loadConfig, saveConfig } from '../../config.js';
import { getProvider, detectProviderForModel } from '../../providers.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  isVoiceAvailable,
  getVoiceStatus,
  installVoice,
  recordAudio,
  stopRecording,
  transcribeAudioFile
} from '../../voice/index.js';
import { clearScreenToTop } from './useResizeRedraw.js';
import { THEMES, THEME_IDS, getThemeId, setTheme } from '../../theme.js';
import { ThemePreview } from '../ThemePreview.js';
import { runUpdate } from '../../update.js';

const h = React.createElement;

const COMMAND_ALIASES = {
  upgrade: 'update',
  v: 'voice',
  tts: 'voice',
  stt: 'voice',
  speak: 'voice',
  ctx: 'context',
  m: 'model',
  models: 'model',
  think: 'effort',
  auth: 'login',
  key: 'login',
  cls: 'clear',
  reset: 'clear',
  stats: 'usage',
  themes: 'theme',
  color: 'theme',
  colors: 'theme',
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
  toolCtxRef.current.allowedCommands = new Set();
  process.stdout.write(clearScreenToTop());
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
async function login(arg, { session, addNote, startGoogleLogin, startXaiLogin, startOpenRouterBrowserLogin, openLoginPicker }) {
  if (arg) {
    const lower = arg.toLowerCase();
    if (lower === 'ollama' || lower === 'local') {
      const res = await connectOllama(session);
      addNote(res.ok ? 'success' : 'warn', res.message);
      return;
    }
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
  let target = (arg || '').trim();
  let provId = null;

  if (target.startsWith('ollama/') || target.startsWith('ollama:')) {
    provId = 'ollama';
    target = target.replace(/^ollama[\/:]/, '');
  } else if (target.toLowerCase() === 'ollama') {
    provId = 'ollama';
    const status = await checkOllamaServer();
    target = status.runningModels[0]?.id || status.models[0]?.id || ctx.session.model;
    if (!target) {
      ctx.addNote('warn', 'В Ollama нет запущенных моделей (ollama ps пуст). Запустите: ollama run <модель>');
      return;
    }
  } else {
    provId = findModel(target)?.provider;
    if (!provId) {
      const status = await checkOllamaServer();
      const inOllama = status.models.find(m => m.id === target || m.id.startsWith(target));
      if (inOllama) {
        provId = 'ollama';
        target = inOllama.id;
      } else {
        provId = detectProviderForModel(target);
      }
    }
  }

  await applyModelChoice(target, provId, ctx);
}

/**
 * Открывает интерактивное меню выбора модели
 */
async function pickModel(ctx) {
  const { session, setOverlay, addNote } = ctx;
  clearCatalogCache('ollama');
  setOverlay({ kind: 'loading', text: 'Загрузка моделей…' });
  let models = [];
  try {
    models = await listModels(loadConfig());
  } catch {
    models = [];
  }

  if (!models || models.length === 0) {
    const status = await checkOllamaServer();
    if (status.running && status.models.length > 0) {
      models = status.models;
    } else {
      setOverlay(null);
      if (status.running) {
        addNote('warn', 'В Ollama нет установленных или запущенных моделей (ollama ps пуст).');
        addNote('info', 'Запустите модель в консоли: ollama run <модель>');
      } else {
        addNote('warn', 'Локальная Ollama не запущена (http://localhost:11434). Запустите: ollama serve');
        addNote('info', 'Для облачных моделей выполните /login');
      }
      return;
    }
  }

  // Группы по провайдерам, которые реально вернули модели (у Ollama ключа нет, есть только сервер)
  const connected = [...new Set(models.map(m => m.provider))];

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
      label: m.running ? `${m.name} · запущен (ps)` : m.name,
      hint: m.running ? `${m.id} · ollama ps` : m.id,
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
 * Открывает интерактивное меню выбора цветовой темы
 *
 * @param {object} ctx
 * @param {object} [options]
 * @param {() => void} [options.onDone]
 */
export function openThemePicker(ctx, { onDone } = {}) {
  const { setOverlay, setStaticKey, addNote } = ctx;
  const items = THEME_IDS.map(id => ({
    label: THEMES[id].title,
    hint: THEMES[id].hint,
    value: id,
    current: loadConfig().theme === id
  }));

  setOverlay({
    kind: 'picker',
    title: 'Выбор темы',
    items,
    initialValue: getThemeId(),
    renderPreview: (id) => h(ThemePreview, { themeId: id }),
    onSelect: (id) => {
      setOverlay(null);
      setTheme(id);
      saveConfig({ theme: id });
      process.stdout.write(clearScreenToTop());
      setStaticKey(k => k + 1);
      addNote('success', `Тема: ${THEMES[id].title}`);
      onDone?.();
    },
    onCancel: () => {
      setOverlay(null);
      onDone?.();
    }
  });
}

/**
 * Обрабатывает команду управления голосом (/voice, /voice on/off, /voice status, /voice install)
 */
async function handleVoiceCommand(arg, ctx) {
  const { session, addNote, setOverlay, handleSend, setDraft } = ctx;
  const sub = (arg || '').trim().toLowerCase();

  if (sub === 'on' || sub === '1' || sub === 'true') {
    session.autoSpeak = true;
    saveConfig({ voiceAutoSpeak: true });
    addNote('success', '🔊 Авто-озвучка ответов включена (TTS: Piper). Для выключения: /voice off');
    if (!isVoiceAvailable()) {
      addNote('warn', 'Авто-озвучка включена, но голос не установлен — выполните /voice install');
    }
    return;
  }

  if (sub === 'off' || sub === '0' || sub === 'false') {
    session.autoSpeak = false;
    saveConfig({ voiceAutoSpeak: false });
    addNote('info', 'Авто-озвучка ответов выключена.');
    return;
  }

  if (sub === 'status') {
    const status = getVoiceStatus();
    addNote('info', `Голосовые компоненты: ${status.available ? 'готовы к работе' : 'не установлены'}`);
    addNote('info', `Piper: ${status.piper ? '✔' : '✖'}, Whisper: ${status.whisper ? '✔' : '✖'}, Модели: ${status.piperModel && status.piperConfig && status.whisperModel ? '✔' : '✖'}`);
    return;
  }

  if (sub === 'install' || sub === 'setup') {
    setOverlay({ kind: 'loading', text: 'Установка голосовых компонентов (Piper & Whisper)…' });
    try {
      await installVoice({
        onProgress: (msg) => setOverlay({ kind: 'loading', text: msg })
      });
      setOverlay(null);
      addNote('success', 'Голосовые компоненты успешно установлены!');
    } catch (err) {
      setOverlay(null);
      addNote('warn', `Ошибка установки: ${err.message}`);
    }
    return;
  }

  if (!isVoiceAvailable()) {
    addNote('warn', 'Голосовые компоненты не установлены. Выполните: /voice install');
    return;
  }

  // Запуск записи с микрофона (STT)
  const tempWav = path.join(os.tmpdir(), `duddy-voice-${Date.now()}.wav`);
  let finished = false;

  const recordPromise = recordAudio(tempWav, { maxDurationMs: 25000 });

  const stopAndTranscribe = async () => {
    if (finished) return;
    finished = true;
    stopRecording();
    setOverlay({ kind: 'loading', text: 'Распознавание речи (whisper.cpp)…' });
    try {
      const recorded = await recordPromise;
      if (recorded === false) {
        setOverlay(null);
        addNote('warn', 'Не удалось записать звук с микрофона — нужен pw-record (PipeWire) или arecord (alsa-utils)');
        return;
      }
      const text = await transcribeAudioFile(tempWav);
      setOverlay(null);
      if (text) {
        if (typeof handleSend === 'function') {
          handleSend(text);
        } else if (typeof setDraft === 'function') {
          setDraft({ text, key: Date.now() });
        }
      } else {
        addNote('warn', 'Голос не распознан (тишина)');
      }
    } catch (err) {
      setOverlay(null);
      addNote('warn', `Ошибка распознавания: ${err.message}`);
    } finally {
      try { if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav); } catch {}
    }
  };

  setOverlay({
    kind: 'recording',
    text: 'Слушаю микрофон… Говорите (Enter или Ctrl+S — отправить, Esc — отмена)',
    onResolve: () => stopAndTranscribe(),
    onCancel: () => {
      finished = true;
      stopRecording();
      setOverlay(null);
      try { if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav); } catch {}
    }
  });

  recordPromise.then(() => {
    if (!finished) {
      stopAndTranscribe();
    }
  });
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
  openLoginPicker,
  handleSend,
  setDraft
}) {
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
    openLoginPicker,
    handleSend,
    setDraft
  };

  const handleCommand = useCallback(async (rawCmd) => {
    const [name, ...rest] = rawCmd.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    const cmd = name.toLowerCase();
    const normalized = COMMAND_ALIASES[cmd] ?? cmd;

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

      case 'effort':
        changeEffort(arg, ctx);
        return;

      case 'login':
        await login(arg, ctx);
        return;

      case 'model':
        if (arg) {
          await changeModel(arg, ctx);
        } else {
          await pickModel(ctx);
        }
        return;

      case 'theme':
        openThemePicker(ctx);
        return;

      case 'voice':
        await handleVoiceCommand(arg, ctx);
        return;

      case 'update': {
        addNote('info', 'Обновление…');
        try {
          const res = await runUpdate();
          if (res.ok) {
            addNote('success', res.message);
          } else {
            addNote('error', res.message);
          }
        } catch (err) {
          addNote('error', `Ошибка обновления: ${err.message}`);
        }
        return;
      }

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

  return { handleCommand, openThemePicker: (opts) => openThemePicker(ctx, opts) };
}
