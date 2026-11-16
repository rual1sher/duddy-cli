/**
 * @fileoverview Диспетчер слэш-команд пользовательского интерфейса Duddy
 */

import { useCallback } from 'react';
import { runUpdate } from '../../update/updateInstall.js';
import {
  changeModel,
  pickModel
} from '../commands/modelCommands.js';
import {
  showHelp,
  clearConversation,
  showUsage,
  showContext,
  changeEffort,
  login
} from '../commands/sessionCommands.js';
import { openThemePicker } from '../commands/themeCommand.js';

export const COMMAND_ALIASES = {
  upgrade: 'update',
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
 * Хук обработки слэш-команд
 *
 * @param {object} params - Параметры инициализации хука
 * @returns {{ handleCommand: Function, openThemePicker: Function }}
 */
export function useCommands({
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
}) {
  const ctx = {
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
    startOpenRouterBrowserLogin,
    openLoginPicker
  ]);

  return { handleCommand, openThemePicker: (opts) => openThemePicker(ctx, opts) };
}
