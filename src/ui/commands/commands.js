/**
 * @fileoverview Слеш-команды сессии Duddy, видимость по провайдеру и модели, справочный экран
 */

import { paint } from '../../render/theme.js';
import { getProvider } from '../../llm/providers.js';
import { findModel } from '../../models/catalog.js';

export const AVAILABLE_COMMANDS = [
  { cmd: '/update', desc: 'Обновить Duddy до последней версии' },
  { cmd: '/model', desc: 'Список моделей ваших провайдеров с поиском' },
  { cmd: '/effort', desc: 'Уровень рассуждений модели: low / medium / high' },
  { cmd: '/login', desc: 'Авторизация в OpenRouter или локальной Ollama' },
  { cmd: '/clear', desc: 'Очистить историю диалога и экран' },
  { cmd: '/context', desc: 'Заполнение окна контекста и истории диалога' },
  { cmd: '/usage', desc: 'Лимиты моделей и расход токенов' },
  { cmd: '/theme', desc: 'Выбрать цветовую тему' },
  { cmd: '/help', desc: 'Показать список всех команд' },
  { cmd: '/exit', desc: 'Выйти из Duddy (или /quit)' }
];

/**
 * Команды, которые имеют смысл для текущей сессии.
 * Локальный провайдер (Ollama): нет /login и /usage. /effort — только если модель умеет рассуждать.
 *
 * @param {object} [session] - Текущая сессия Duddy
 * @returns {Array<{ cmd: string, desc: string }>} Список доступных команд
 */
export function commandsFor(session) {
  const provider = getProvider(session?.provider);
  const isLocal = Boolean(provider?.local);
  const modelInfo = findModel(session?.model);

  const showEffort = isLocal
    ? modelInfo?.thinking === true
    : modelInfo?.thinking !== false;

  return AVAILABLE_COMMANDS.filter((item) => {
    if (isLocal && (item.cmd === '/login' || item.cmd === '/usage')) {
      return false;
    }
    if (item.cmd === '/effort' && !showEffort) {
      return false;
    }
    return true;
  });
}

/**
 * Формирует строки справки по слеш-командам и возможностям агента.
 *
 * @param {object} [session] - Текущая сессия Duddy
 * @returns {string[]} Массив строк справки
 */
export function helpLines(session) {
  const lines = [
    paint('accent').bold('⚡ Доступные слеш-команды:')
  ];
  for (const item of commandsFor(session)) {
    lines.push(`  ${paint('warning')(item.cmd.padEnd(16))} ${paint('subtle')('—')} ${item.desc}`);
  }
  lines.push('');
  lines.push(paint('subtle')('💡 Подсказки:'));
  lines.push(paint('subtle')('  / — команды'));
  lines.push(paint('subtle')('  Shift+Tab — режим: обычный → правки без подтверждения → план → авто'));
  lines.push(paint('subtle')('  Esc — прервать ответ / очистить ввод'));
  lines.push(paint('subtle')('  Ctrl+C ×2 — выход'));
  lines.push('');
  lines.push(paint('accent').bold('🛠️  Файловые операции (AI Agent):'));
  lines.push(paint('subtle')('  Попросите создать/прочитать/изменить файл — Duddy спросит подтверждение.'));
  return lines;
}
