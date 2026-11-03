/**
 * @fileoverview Режимы разрешений агента (default, acceptEdits, plan, auto)
 */

export const MODES = ['default', 'acceptEdits', 'plan', 'auto'];

export const MODE_INFO = {
  default: { label: '', color: null },
  acceptEdits: { label: '⏵⏵ правки без подтверждения', color: 'success' },
  plan: { label: '⏸ план — только чтение', color: 'accent' },
  auto: { label: '⏵⏵⏵ авто', color: 'warning' }
};

export const WRITE_TOOLS = new Set([
  'create_file',
  'create_folder',
  'edit_file',
  'delete_file',
  'delete_folder'
]);

/**
 * Циклически переключает режимы: default → acceptEdits → plan → auto → default.
 * Неизвестный режим сбрасывается в default.
 *
 * @param {string} mode
 * @returns {string}
 */
export function nextMode(mode) {
  const idx = MODES.indexOf(mode);
  if (idx === -1) return MODES[0];
  return MODES[(idx + 1) % MODES.length];
}

/**
 * Применяет режим к контексту инструментов.
 *
 * @param {object} ctx
 * @param {string} mode
 * @returns {object}
 */
export function applyMode(ctx, mode) {
  const target = ctx || {};
  target.mode = mode;
  target.autoApprove = mode === 'acceptEdits' || mode === 'auto';
  target.allowCommands = mode === 'auto';
  return target;
}

/**
 * Возвращает список инструментов, доступных в данном режиме.
 * В режиме plan инструменты записи скрываются от модели.
 *
 * @param {Array<object>} tools
 * @param {string} mode
 * @returns {Array<object>}
 */
export function toolsForMode(tools, mode) {
  if (mode === 'plan') {
    return tools.filter(t => !WRITE_TOOLS.has(t.function?.name));
  }
  return tools;
}

/**
 * Системная инструкция для режима планирования (plan)
 */
export const PLAN_MODE_PROMPT =
  'Включён режим планирования (только чтение). Тебе запрещено изменять файлы и выполнять любые команды bash, кроме безопасных только для чтения. ' +
  'Изучи кодовую базу с помощью инструментов чтения и поиска, затем предоставь пошаговый план изменений: какие файлы затронуты, что именно в них меняется и какие есть потенциальные риски. ' +
  'Не пытайся обойти ограничения через bash. Пользователь сам переключит режим (Shift+Tab), когда предложенный план его устроит.';
