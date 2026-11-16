/** @fileoverview Запрос подтверждения пользователя на потенциально опасные операции */

/**
 * Asks user for approval before performing dangerous operations.
 * Sensitive actions ignore autoApprove: every access needs its own explicit "yes".
 * Commands ignore it too: a session-wide "yes" for files must not open the whole shell.
 *
 * @param {string} name - Tool name
 * @param {string} relPath - Relative path of the target, or a short command title
 * @param {object} [ctx={}] - Tool execution context
 * @param {Array<object>} [preview=[]] - Changes preview items
 * @param {object} [options]
 * @param {boolean} [options.sensitive=false] - The action may expose secrets or cause harm
 * @param {string} [options.commandKey] - Full command text: "all" then remembers only this command
 * @param {string} [options.deniedMessage] - Message when nobody can answer
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
export async function requestApproval(name, relPath, ctx = {}, preview = [], { sensitive = false, commandKey, deniedMessage } = {}) {
  const log = (level, text) => {
    if (typeof ctx.log === 'function') ctx.log(level, text);
  };

  if (ctx.autoApprove && !sensitive && !commandKey) {
    return { approved: true };
  }

  if (ctx.canPrompt === false || typeof ctx.approve !== 'function') {
    const msg = deniedMessage ?? (sensitive
      ? `Отклонено: "${relPath}" может содержать секреты, для ${name} нужно явное подтверждение в интерактивном режиме (флаг --yes его не заменяет).`
      : `Отклонено: действие "${name}" требует подтверждения, но интерактивный ввод недоступен (запустите duddy с флагом --yes, чтобы разрешить изменения файлов).`);
    log('warn', msg);
    return { approved: false, message: msg };
  }

  const waitStart = Date.now();
  let answer;
  try {
    answer = await ctx.approve({ name, relPath, preview, sensitive, scope: commandKey ? 'command' : 'file' });
  } finally {
    ctx.approvalWaitMs = (ctx.approvalWaitMs || 0) + (Date.now() - waitStart);
  }

  if (answer === 'all' && !sensitive) {
    if (commandKey) {
      ctx.allowedCommands ??= new Set();
      ctx.allowedCommands.add(commandKey);
    } else {
      if (typeof ctx.setMode === 'function') {
        ctx.setMode('acceptEdits');
      } else {
        ctx.autoApprove = true;
      }
    }
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
