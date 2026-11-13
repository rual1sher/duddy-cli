/**
 * @fileoverview Команды управления моделями (/model) в TUI Duddy
 */

import { selectModel } from '../../session-actions.js';
import { warmupLocalModel } from '../../llm/warmup.js';
import { getProvider, detectProviderForModel } from '../../providers.js';
import { checkOllamaServer } from '../../models/ollama.js';
import { findModel, listModels, clearCatalogCache } from '../../models/catalog.js';
import { loadConfig } from '../../config.js';
import { UNAVAILABLE_REASONS } from '../../models/status.js';

/**
 * Применяет выбор модели с повторной попыткой после авторизации при необходимости.
 *
 * @param {string} id - Идентификатор модели
 * @param {string} provider - Идентификатор провайдера
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function applyModelChoice(id, provider, ctx) {
  const { session, addNote, openLoginPicker, mode } = ctx;
  const res = await selectModel(session, id, provider);
  if (res.needsLogin) {
    openLoginPicker(async () => {
      const retry = await selectModel(session, id, res.needsLogin);
      if (retry.ok) {
        addNote('success', retry.message);
        if (getProvider(session.provider)?.local) {
          warmupLocalModel(session, { mode: mode || 'default' });
        }
      }
    });
    return;
  }
  if (res.ok) {
    addNote('success', res.message);
    if (getProvider(session.provider)?.local) {
      warmupLocalModel(session, { mode: mode || 'default' });
    }
  } else {
    addNote('warn', res.message);
  }
}

/**
 * Переключает модель по указанному идентификатору.
 *
 * @param {string} arg - Аргумент команды с идентификатором модели
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function changeModel(arg, ctx) {
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
 * Открывает интерактивное меню выбора модели.
 *
 * @param {object} ctx - Контекст команд TUI
 * @returns {Promise<void>}
 */
export async function pickModel(ctx) {
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
