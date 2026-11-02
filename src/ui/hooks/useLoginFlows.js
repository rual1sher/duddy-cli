/**
 * @fileoverview Сценарии авторизации в провайдерах нейросетей (Google AI Studio, OpenRouter, xAI)
 */

import { useCallback } from 'react';
import { connectGoogle, connectXai, saveOpenRouterKey } from '../../session-actions.js';
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
  const startApiKeyLogin = useCallback(({ url, note, title, connect }, onSuccess) => {
    openBrowser(url);
    addNote('info', note);
    setOverlay({
      kind: 'secret',
      title,
      onSubmit: async (key) => {
        setOverlay({ kind: 'loading', text: 'Проверка ключа…' });
        try {
          const msg = await connect(session, key);
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

  const startGoogleLogin = useCallback((onSuccess) => {
    startApiKeyLogin({
      url: 'https://aistudio.google.com/apikey',
      note: 'Откройте aistudio.google.com/apikey, создайте ключ и вставьте его',
      title: 'API-ключ Google AI Studio',
      connect: connectGoogle
    }, onSuccess);
  }, [startApiKeyLogin]);

  const startXaiLogin = useCallback((onSuccess) => {
    startApiKeyLogin({
      url: 'https://console.x.ai',
      note: 'Откройте console.x.ai, создайте API-ключ и вставьте его',
      title: 'API-ключ xAI',
      connect: connectXai
    }, onSuccess);
  }, [startApiKeyLogin]);

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
        { label: 'Google AI Studio — вставить ключ', hint: 'Gemini API', value: 'google' },
        { label: 'xAI (Grok) — вставить ключ', hint: 'XAI_API_KEY', value: 'xai' }
      ],
      onSelect: (choice) => {
        setOverlay(null);
        if (choice === 'openrouter_browser') {
          startOpenRouterBrowserLogin(onSuccess);
        } else if (choice === 'openrouter_manual') {
          startOpenRouterManualLogin(onSuccess);
        } else if (choice === 'google') {
          startGoogleLogin(onSuccess);
        } else if (choice === 'xai') {
          startXaiLogin(onSuccess);
        }
      },
      onCancel: () => setOverlay(null)
    });
  }, [setOverlay, startGoogleLogin, startXaiLogin, startOpenRouterBrowserLogin, startOpenRouterManualLogin]);

  return {
    startGoogleLogin,
    startXaiLogin,
    startOpenRouterBrowserLogin,
    startOpenRouterManualLogin,
    openLoginPicker
  };
}
