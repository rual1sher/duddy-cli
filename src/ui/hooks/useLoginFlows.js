/**
 * @fileoverview Сценарии авторизации в провайдерах нейросетей (OpenRouter, локальная Ollama)
 */

import { useCallback } from 'react';
import { connectOllama, saveOpenRouterKey } from '../../session/session-actions.js';
import { startBrowserLogin } from '../../session/auth.js';
import { warmupLocalModel } from '../../llm/warmup.js';
import { getProvider } from '../../llm/providers.js';

/**
 * Хук со сценариями авторизации пользователя в провайдерах
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия
 * @param {Function} params.setOverlay - Сеттер активного оверлея
 * @param {Function} params.addNote - Добавление системной заметки в транскрипт
 * @returns {object}
 */
export function useLoginFlows({ session, setOverlay, addNote }) {
  const startOpenRouterBrowserLogin = useCallback((onSuccess) => {
    const { url, result, cancel } = startBrowserLogin();
    setOverlay({
      kind: 'browser',
      url,
      cancel: () => {
        cancel();
        setOverlay(null);
        addNote('info', 'Вход отменён');
      }
    });
    result.then(async (key) => {
      setOverlay(null);
      if (key) {
        const msg = saveOpenRouterKey(session, key);
        addNote('success', msg);
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
      } else {
        addNote('info', 'Вход отменён');
      }
    });
  }, [session, setOverlay, addNote]);

  const startOpenRouterManualLogin = useCallback((onSuccess) => {
    setOverlay({
      kind: 'secret',
      title: 'API-ключ OpenRouter (sk-or-...)',
      onSubmit: async (key) => {
        setOverlay(null);
        const msg = saveOpenRouterKey(session, key);
        addNote('success', msg);
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [session, setOverlay, addNote]);

  const openLoginPicker = useCallback((onSuccess) => {
    setOverlay({
      kind: 'picker',
      title: 'Авторизация в провайдерах',
      searchable: false,
      items: [
        { label: 'Локальная Ollama (без API-ключа)', hint: 'localhost:11434', value: 'ollama' },
        { label: 'OpenRouter — войти через браузер', hint: 'OAuth', value: 'openrouter_browser' },
        { label: 'OpenRouter — вставить ключ', hint: 'sk-or-...', value: 'openrouter_manual' }
      ],
      onSelect: async (choice) => {
        setOverlay(null);
        if (choice === 'ollama') {
          const res = await connectOllama(session);
          addNote(res.ok ? 'success' : 'warn', res.message);
          if (res.ok && getProvider(session.provider)?.local) {
            warmupLocalModel(session);
          }
          if (res.ok && typeof onSuccess === 'function') {
            await onSuccess();
          }
          return;
        }
        if (choice === 'openrouter_browser') {
          startOpenRouterBrowserLogin(onSuccess);
        } else if (choice === 'openrouter_manual') {
          startOpenRouterManualLogin(onSuccess);
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [session, setOverlay, addNote, startOpenRouterBrowserLogin, startOpenRouterManualLogin]);

  return {
    startOpenRouterBrowserLogin,
    startOpenRouterManualLogin,
    openLoginPicker
  };
}
