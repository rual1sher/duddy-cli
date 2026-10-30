/** @fileoverview Запрос подтверждения пользователя на потенциально опасные операции с файлами */

/**
 * Asks user for approval before performing dangerous file operations.
 *
 * @param {string} name - Tool name
 * @param {string} relPath - Relative path of the target file or folder
 * @param {object} [ctx={}] - Tool execution context
 * @param {Array<object>} [preview=[]] - Changes preview items
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
export async function requestApproval(name, relPath, ctx = {}, preview = []) {
  const log = (level, text) => {
    if (typeof ctx.log === 'function') ctx.log(level, text);
  };

  if (ctx.autoApprove) {
    return { approved: true };
  }

  if (ctx.canPrompt === false || typeof ctx.approve !== 'function') {
    const msg = `Отклонено: действие "${name}" требует подтверждения, но интерактивный ввод недоступен (запустите duddy с флагом --yes, чтобы разрешить изменения файлов).`;
    log('warn', msg);
    return { approved: false, message: msg };
  }

  const answer = await ctx.approve({ name, relPath, preview });

  if (answer === 'all') {
    ctx.autoApprove = true;
    return { approved: true };
  }

  if (answer === 'yes') {
    return { approved: true };
  }

  log('warn', '⊘ Отменено');
  return {
    approved: false,
    message: `Отклонено пользователем: действие ${name} для "${relPath}" не выполнено. Не повторяй это действие без нового запроса пользователя.`
  };
}
