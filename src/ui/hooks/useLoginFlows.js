/**
 * @fileoverview Сценарии авторизации в провайдерах нейросетей (Google AI Studio, OpenRouter)
 */

import { useCallback } from 'react';
import { connectGoogle, saveOpenRouterKey } from '../../session-actions.js';
import { startBrowserLogin, openBrowser } from '../../auth.js';

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
  const startGoogleLogin = useCallback((onSuccess) => {
    openBrowser('https://aistudio.google.com/apikey');
    addNote('info', 'Откройте aistudio.google.com/apikey, создайте ключ и вставьте его');
    setOverlay({
      kind: 'secret',
      title: 'API-ключ Google AI Studio',
      onSubmit: async (key) => {
        setOverlay({ kind: 'loading', text: 'Проверка ключа…' });
        try {
          const msg = await connectGoogle(session, key);
          addNote('success', msg);
          if (typeof onSuccess === 'function') {
            await onSuccess();
          }
        } catch (err) {
          addNote('error', err.message);
        } finally {
          setOverlay(null);
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [session, setOverlay, addNote]);

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
  }, [setOverlay, startGoogleLogin, startOpenRouterBrowserLogin, startOpenRouterManualLogin]);

  return {
    startGoogleLogin,
    startOpenRouterBrowserLogin,
    startOpenRouterManualLogin,
    openLoginPicker
  };
}
