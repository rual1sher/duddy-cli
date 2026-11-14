/**
 * @fileoverview Сессионные команды интерфейса (/help, /clear, /usage, /context, /effort, /login)
 */

import { helpLines, commandsFor } from './commands.js';
import { clearScreenToTop } from '../hooks/useResizeRedraw.js';
import { getProvider } from '../../llm/providers.js';
import { usageLines } from '../../reports/usageReport.js';
import { contextLines } from '../../reports/contextReport.js';
import { setEffort, saveOpenRouterKey, connectOllama } from '../../session/session-actions.js';
import { warmupLocalModel } from '../../llm/warmup.js';

/**
 * Выводит справочный экран по командам.
 *
 * @param {object} ctx - Контекст команд TUI
 */
export function showHelp({ session, setTranscript }) {
  const lines = helpLines(session);
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Очищает историю сообщений диалога и перезапускает экран.
 *
 * @param {object} ctx - Контекст команд TUI
 */
export function clearConversation({
  session,
  queueRef,
  setQueued,
  toolCtxRef,
  setTranscript,
  setStaticKey
}) {
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
 * Выводит статистику расхода токенов и лимитов.
 *
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function showUsage({ session, setTranscript, addNote }) {
  if (getProvider(session?.provider).local) {
    addNote('info', 'У локальных моделей нет лимитов и расхода.');
    return;
  }
  const lines = await usageLines(session);
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Выводит информацию об окне контекста и истории сообщений.
 *
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function showContext({ session, setTranscript }) {
  const lines = await contextLines(session);
  setTranscript(prev => [...prev, { type: 'lines', lines }]);
}

/**
 * Изменяет уровень рассуждений (reasoning effort).
 *
 * @param {string} arg - Аргумент команды с уровнем рассуждений
 * @param {object} ctx - Контекст команд TUI
 */
export function changeEffort(arg, { session, setOverlay, addNote }) {
  if (!commandsFor(session).some(c => c.cmd === '/effort')) {
    addNote('info', 'Эта модель не умеет рассуждать — уровень не нужен.');
    return;
  }
  if (arg) {
    const msg = setEffort(session, arg);
    const isErr = msg.startsWith('Неизвестный');
    addNote(isErr ? 'warn' : 'success', msg);
    return;
  }
  const isLocal = Boolean(getProvider(session?.provider)?.local);
  setOverlay({
    kind: 'picker',
    title: 'Уровень рассуждений (reasoning effort)',
    searchable: false,
    items: [
      {
        label: 'auto',
        hint: isLocal ? 'без рассуждений (быстро)' : 'по умолчанию модели',
        value: 'auto',
        current: (session.reasoningEffort || 'auto') === 'auto'
      },
      {
        label: 'low',
        hint: 'быстрее',
        value: 'low',
        current: session.reasoningEffort === 'low'
      },
      {
        label: 'medium',
        hint: 'баланс',
        value: 'medium',
        current: session.reasoningEffort === 'medium'
      },
      {
        label: 'high',
        hint: 'качественнее, медленнее',
        value: 'high',
        current: session.reasoningEffort === 'high'
      }
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
 * Выполняет сценарий входа в провайдер.
 *
 * @param {string} arg - Аргумент команды
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function login(arg, ctx) {
  const { session, addNote, startOpenRouterBrowserLogin, openLoginPicker, mode } = ctx;
  if (arg) {
    const lower = arg.toLowerCase();
    if (lower === 'ollama' || lower === 'local') {
      const res = await connectOllama(session);
      addNote(res.ok ? 'success' : 'warn', res.message);
      if (res.ok && getProvider(session.provider)?.local) {
        warmupLocalModel(session, { mode: mode || 'default' });
      }
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
