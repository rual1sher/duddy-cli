/** @fileoverview Диспетчеризация и исполнение вызовов инструментов агента */

import {
  createFile,
  createFolder,
  readFile,
  editFile,
  deleteFile,
  deleteFolder,
  listDir
} from './fileTools.js';
import { grepFiles, globFiles } from './searchTools.js';
import { runBash } from './bashTool.js';

const HANDLERS = {
  create_file: createFile,
  create_folder: createFolder,
  read_file: readFile,
  edit_file: editFile,
  delete_file: deleteFile,
  delete_folder: deleteFolder,
  list_dir: listDir,
  grep: grepFiles,
  glob: globFiles,
  bash: runBash
};

function createLog(ctx) {
  return (level, text) => {
    if (typeof ctx?.log === 'function') ctx.log(level, text);
  };
}

/**
 * Execute a tool requested by the model.
 * Dangerous operations require user confirmation unless auto-approved.
 *
 * @param {string} name - Tool name to execute
 * @param {object} [args={}] - Arguments for the tool
 * @param {object} [ctx={}] - Execution context { autoApprove, canPrompt, log, approve }
 * @param {object} [meta={}] - Filled by the tool: meta.secret means the output must not stay in history
 * @returns {Promise<string>} Tool output string
 */
export async function executeTool(name, args = {}, ctx = {}, meta = {}) {
  const log = createLog(ctx);

  try {
    if (!Object.hasOwn(HANDLERS, name)) {
      return `Ошибка: Неизвестный инструмент ${name}`;
    }

    const handler = HANDLERS[name];
    return await handler(args, ctx, log, meta);
  } catch (err) {
    log('error', `✖ Ошибка при выполнении ${name}: ${err.message}`);
    return `Ошибка: ${err.message}`;
  }
}
