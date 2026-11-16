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
  'Plan mode (read-only) is on. Do not change files or run bash commands other than safe read-only ones, and do not try to bypass this through bash. ' +
  'Explore the code with the read and search tools, then give a step-by-step plan: which files change, what exactly changes in each, and the risks. ' +
  'The user will switch the mode (Shift+Tab) when the plan is approved.';
