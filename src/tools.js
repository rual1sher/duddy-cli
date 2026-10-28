import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Создать новый файл или полностью перезаписать существующий файл с указанным содержимым. Используйте для создания новых файлов или для полной перезаписи (когда меняется весь файл или большая его часть). Автоматически создает родительские папки.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Имя и относительный путь к файлу (например: "index.html" или "src/utils.js"). Не передавайте имя папки или "."'
          },
          content: {
            type: 'string',
            description: 'Полное содержимое файла'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Создать новую папку (директорию). Автоматически создает все недостающие родительские папки.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к папке, например: "src/components" или "assets/icons"'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Прочитать текстовое содержимое существующего файла.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к файлу для чтения, например: "package.json"'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Точечно заменить небольшой фрагмент существующего текста в файле (old_content) на новый фрагмент (new_content). Для полной перезаписи всего файла используйте create_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Имя и относительный путь к файлу (например: "index.html" или "src/utils.js")'
          },
          old_content: {
            type: 'string',
            description: 'Точный непрерывный фрагмент существующего текста из файла, который нужно заменить. Для лучшего совпадения предварительно прочитайте файл через read_file.'
          },
          new_content: {
            type: 'string',
            description: 'Новый текст, который заменит old_content'
          }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Удалить файл из файловой системы.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к удаляемому файлу'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_folder',
      description: 'Удалить папку (директорию) и всё её содержимое.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к удаляемой папке'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Получить список файлов и подпапок в указанной директории.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к директории (по умолчанию "." для текущей рабочей папки)'
          }
        }
      }
    }
  }
];

/**
 * Resolves a target path safely within the root working directory.
 * Protects against directory traversal and symlink breakout.
 *
 * @param {string} targetPath - Path to resolve
 * @param {object} [options]
 * @param {boolean} [options.followFinalSymlink=true] - Whether to follow symlinks for the final target
 * @returns {Promise<{ fullPath: string, relPath: string, error: string|null }>}
 */
async function resolveSafePath(targetPath, { followFinalSymlink = true } = {}) {
  const root = await fs.realpath(process.cwd());
  const fullPath = path.resolve(root, targetPath || '.');
  const relPath = path.relative(root, fullPath) || '.';

  let curr = fullPath;
  const segments = [];

  if (!followFinalSymlink && fullPath !== root) {
    segments.push(path.basename(fullPath));
    curr = path.dirname(fullPath);
  }

  let real;
  while (true) {
    try {
      const realCurr = await fs.realpath(curr);
      const tail = [...segments].reverse();
      real = tail.length > 0 ? path.join(realCurr, ...tail) : realCurr;
      break;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // A dangling symlink also yields ENOENT, but writing through it would escape root
        const isDanglingLink = await fs.lstat(curr).then(s => s.isSymbolicLink(), () => false);
        if (isDanglingLink) {
          return {
            fullPath,
            relPath,
            error: `Ошибка: Доступ запрещён — путь "${targetPath}" ведёт через битую символическую ссылку.`
          };
        }
        const parent = path.dirname(curr);
        if (parent === curr) {
          const tail = [...segments].reverse();
          real = tail.length > 0 ? path.join(curr, ...tail) : curr;
          break;
        }
        segments.push(path.basename(curr));
        curr = parent;
      } else {
        throw err;
      }
    }
  }

  const rel = path.relative(root, real);
  const isOutside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);

  if (isOutside) {
    return {
      fullPath,
      relPath,
      error: `Ошибка: Доступ запрещён — путь "${targetPath}" находится за пределами рабочей папки ${root}.`
    };
  }

  return { fullPath, relPath, error: null };
}

/**
 * Validates that targetPath is a valid file path and not a directory or empty
 */
function validateFilePath(targetPath, toolName) {
  if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim() || targetPath.trim() === '.' || targetPath.trim() === './') {
    return `Ошибка: Не указано имя файла в параметре path (получено "${targetPath || ''}"). Укажите путь к файлу, например: "index.html".`;
  }
  return null;
}

/**
 * Counts non-overlapping occurrences of needle in haystack
 */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Multi-tier resilient string replacement for AI tool calling.
 * Handles exact matches, CRLF/LF normalization, trimmed edge differences,
 * and line-by-line whitespace/indentation tolerant matches.
 */
function fuzzyReplace(original, oldContent, newContent) {
  if (!oldContent || typeof oldContent !== 'string') {
    return { success: false, reason: 'empty_old_content' };
  }

  // Tier 1: Exact match
  if (original.includes(oldContent)) {
    const count = countOccurrences(original, oldContent);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    return { success: true, content: original.replace(oldContent, () => newContent), method: 'exact' };
  }

  const isCrlf = original.includes('\r\n');
  const normOriginal = original.replace(/\r\n/g, '\n');
  const normOld = oldContent.replace(/\r\n/g, '\n');
  const normNew = newContent.replace(/\r\n/g, '\n');

  // Tier 2: CRLF-normalized match
  if (normOriginal.includes(normOld)) {
    const count = countOccurrences(normOriginal, normOld);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    const res = normOriginal.replace(normOld, () => normNew);
    return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: 'crlf-normalized' };
  }

  // Tier 3: Whole-file match (trimmed)
  if (normOriginal.trim() === normOld.trim()) {
    return { success: true, content: isCrlf ? normNew.replace(/\n/g, '\r\n') : normNew, method: 'whole-file' };
  }

  // Tier 4: Trimmed edges match (leading/trailing newlines/spaces)
  const trimmedOld = normOld.trim();
  if (trimmedOld && normOriginal.includes(trimmedOld)) {
    const count = countOccurrences(normOriginal, trimmedOld);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    const res = normOriginal.replace(trimmedOld, () => normNew.trim());
    return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: 'trimmed-edges' };
  }

  // Tier 5: Line-by-line whitespace-tolerant match (trimEnd & trim)
  const origLines = normOriginal.split('\n');
  const oldLines = normOld.split('\n');

  let startOld = 0;
  while (startOld < oldLines.length && !oldLines[startOld].trim()) startOld++;
  let endOld = oldLines.length - 1;
  while (endOld >= startOld && !oldLines[endOld].trim()) endOld--;

  if (startOld <= endOld) {
    const searchLines = oldLines.slice(startOld, endOld + 1);
    const searchLen = searchLines.length;

    for (const mode of ['trimEnd', 'trim']) {
      const matches = [];
      for (let i = 0; i <= origLines.length - searchLen; i++) {
        let match = true;
        for (let j = 0; j < searchLen; j++) {
          const l1 = origLines[i + j][mode]();
          const l2 = searchLines[j][mode]();
          if (l1 !== l2) {
            match = false;
            break;
          }
        }
        if (match) {
          matches.push(i);
        }
      }

      if (matches.length > 1) {
        return { success: false, reason: 'ambiguous', count: matches.length };
      }

      if (matches.length === 1) {
        const matchIdx = matches[0];
        const newLines = normNew.split('\n');
        const replacedLines = [
          ...origLines.slice(0, matchIdx),
          ...newLines,
          ...origLines.slice(matchIdx + searchLen)
        ];
        const res = replacedLines.join('\n');
        return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: `fuzzy-lines-${mode}` };
      }
    }
  }

  return { success: false, reason: 'not_found' };
}

/**
 * Asks user for approval before performing dangerous file operations.
 *
 * @param {string} name - Tool name
 * @param {string} relPath - Relative path of the target file or folder
 * @param {object} [ctx={}] - Tool execution context
 * @param {Array<object>} [preview=[]] - Changes preview items
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
async function requestApproval(name, relPath, ctx = {}, preview = []) {
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

/**
 * Execute a tool requested by the model.
 * Dangerous file operations require user confirmation unless auto-approved.
 *
 * @param {string} name - Tool name to execute
 * @param {object} [args={}] - Arguments for the tool
 * @param {object} [ctx={}] - Execution context { autoApprove, canPrompt, log, approve }
 * @returns {Promise<string>} Tool output string
 */
export async function executeTool(name, args = {}, ctx = {}) {
  const log = (level, text) => {
    if (typeof ctx.log === 'function') ctx.log(level, text);
  };

  try {
    switch (name) {
      case 'create_file': {
        const pathError = validateFilePath(args.path, 'create_file');
        if (pathError) {
          log('error', `✖ ${pathError}`);
          return pathError;
        }

        const { fullPath, relPath, error } = await resolveSafePath(args.path);
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        const content = args.content ?? '';
        const exists = fsSync.existsSync(fullPath);

        if (exists) {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            log('error', `✖ Ошибка: "${relPath}" является папкой, а не файлом.`);
            return `Ошибка: Путь "${relPath}" является директорией, а не файлом. Укажите полное имя создаваемого файла, например "${relPath}/index.html".`;
          }
        }

        const statusText = exists ? 'ПЕРЕЗАПИСЬ существующего файла' : 'новый файл';
        const preview = [{
          kind: exists ? 'warn' : 'info',
          text: `Файл: ${relPath} (${statusText}, ${content.length} байт)`
        }];

        const approval = await requestApproval('create_file', relPath, ctx, preview);
        if (!approval.approved) {
          return approval.message;
        }

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf8');
        log('success', `✔ Файл сохранен: ${relPath} (${content.length} байт)`);
        return `✓ Файл ${relPath} успешно сохранен (${content.length} байт).`;
      }

      case 'create_folder': {
        const { fullPath, relPath, error } = await resolveSafePath(args.path);
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        const exists = fsSync.existsSync(fullPath);

        if (exists) {
          log('info', `ℹ Папка ${relPath} уже существует.`);
          return `✓ Папка ${relPath} уже существует.`;
        }

        await fs.mkdir(fullPath, { recursive: true });
        log('success', `✔ Папка создана: ${relPath}`);
        return `✓ Папка ${relPath} успешно создана.`;
      }

      case 'read_file': {
        const pathError = validateFilePath(args.path, 'read_file');
        if (pathError) {
          log('error', `✖ ${pathError}`);
          return pathError;
        }

        const { fullPath, relPath, error } = await resolveSafePath(args.path);
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        if (!fsSync.existsSync(fullPath)) {
          log('error', `✖ Файл не найден: ${relPath}`);
          return `Ошибка: Файл ${relPath} не найден.`;
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return `Ошибка: Путь ${relPath} является папкой, а не файлом. Используйте list_dir.`;
        }

        log('info', `📖 Чтение файла: ${relPath}`);
        let content = await fs.readFile(fullPath, 'utf8');

        // Limit huge files to prevent context blowout
        const MAX_CHARS = 40000;
        if (content.length > MAX_CHARS) {
          content = content.slice(0, MAX_CHARS) + `\n\n...[Обрезано: файл слишком большой (${stats.size} байт)]...`;
        }

        return content;
      }

      case 'edit_file': {
        const pathError = validateFilePath(args.path, 'edit_file');
        if (pathError) {
          log('error', `✖ ${pathError}`);
          return pathError;
        }

        const { fullPath, relPath, error } = await resolveSafePath(args.path);
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        if (!fsSync.existsSync(fullPath)) {
          log('error', `✖ Файл не найден: ${relPath}`);
          return `Ошибка: Файл ${relPath} не существует. Чтобы создать его, используйте create_file.`;
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return `Ошибка: Путь "${relPath}" является директорией, а не файлом.`;
        }

        const oldContent = args.old_content ?? '';
        const newContent = args.new_content ?? '';

        if (!oldContent.trim()) {
          log('error', `✖ Параметр old_content пуст в ${relPath}`);
          return `Ошибка: Параметр old_content пуст. Для полной перезаписи файла используйте create_file(path: "${relPath}", content: "...").`;
        }

        const original = await fs.readFile(fullPath, 'utf8');
        const replaceResult = fuzzyReplace(original, oldContent, newContent);

        if (!replaceResult.success) {
          if (replaceResult.reason === 'ambiguous') {
            const msg = `Ошибка: фрагмент old_content встречается в ${relPath} ${replaceResult.count} раз(а). Добавь в old_content больше соседних строк, чтобы совпадение было единственным.`;
            log('error', `✖ ${msg}`);
            return msg;
          }
          log('error', `✖ Фрагмент для замены не найден в ${relPath}`);
          return `Ошибка: Указанный old_content не найден в файле ${relPath}.
Подсказки для исправления:
1. Если вы хотите полностью перезаписать файл новым содержимым — вызовите инструмент create_file(path: "${relPath}", content: "...").
2. Для частичной замены сначала вызовите read_file, скопируйте точный непрерывный фрагмент строк из файла (включая отступы).`;
        }

        const preview = [];
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const previewOld = oldLines.slice(0, 12);
        for (const line of previewOld) {
          preview.push({ kind: 'del', text: line });
        }
        if (oldLines.length > 12) {
          preview.push({ kind: 'info', text: `… ещё ${oldLines.length - 12} строк` });
        }
        const previewNew = newLines.slice(0, 12);
        for (const line of previewNew) {
          preview.push({ kind: 'add', text: line });
        }
        if (newLines.length > 12) {
          preview.push({ kind: 'info', text: `… ещё ${newLines.length - 12} строк` });
        }

        const approval = await requestApproval('edit_file', relPath, ctx, preview);
        if (!approval.approved) {
          return approval.message;
        }

        await fs.writeFile(fullPath, replaceResult.content, 'utf8');
        log('success', `✔ Файл обновлен: ${relPath}`);
        return `✓ Файл ${relPath} успешно изменен.`;
      }

      case 'delete_file': {
        const pathError = validateFilePath(args.path, 'delete_file');
        if (pathError) {
          log('error', `✖ ${pathError}`);
          return pathError;
        }

        const { fullPath, relPath, error } = await resolveSafePath(args.path, { followFinalSymlink: false });
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        let stats;
        try {
          stats = await fs.lstat(fullPath);
        } catch (e) {
          log('error', `✖ Файл не найден: ${relPath}`);
          return `Ошибка: Файл ${relPath} не существует.`;
        }

        if (stats.isDirectory()) {
          log('error', `✖ Ошибка: Путь "${relPath}" является папкой.`);
          return `Ошибка: Путь "${relPath}" является папкой. Для удаления папок используйте delete_folder.`;
        }

        const preview = [{ kind: 'del', text: relPath }];

        const approval = await requestApproval('delete_file', relPath, ctx, preview);
        if (!approval.approved) {
          return approval.message;
        }

        await fs.unlink(fullPath);
        log('success', `✔ Файл удален: ${relPath}`);
        return `✓ Файл ${relPath} успешно удален.`;
      }

      case 'delete_folder': {
        const { fullPath, relPath, error } = await resolveSafePath(args.path, { followFinalSymlink: false });
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        if (relPath === '.') {
          log('error', `✖ Ошибка: Нельзя удалить корневую рабочую папку.`);
          return `Ошибка: Нельзя удалить корневую рабочую папку.`;
        }

        let lstats;
        try {
          lstats = await fs.lstat(fullPath);
        } catch (e) {
          log('error', `✖ Папка не найдена: ${relPath}`);
          return `Ошибка: Папка ${relPath} не существует.`;
        }

        if (lstats.isSymbolicLink()) {
          const errMsg = `Ошибка: Путь "${relPath}" является символической ссылкой, удалите её через delete_file.`;
          log('error', `✖ ${errMsg}`);
          return errMsg;
        }

        if (!lstats.isDirectory()) {
          log('error', `✖ Ошибка: Путь "${relPath}" является файлом.`);
          return `Ошибка: Путь "${relPath}" является файлом. Для удаления файлов используйте delete_file.`;
        }

        const entries = await fs.readdir(fullPath).catch(() => []);
        const preview = [{ kind: 'del', text: `${relPath} (${entries.length} элементов верхнего уровня)` }];

        const approval = await requestApproval('delete_folder', relPath, ctx, preview);
        if (!approval.approved) {
          return approval.message;
        }

        await fs.rm(fullPath, { recursive: true, force: true });
        log('success', `✔ Папка удалена: ${relPath}`);
        return `✓ Папка ${relPath} со всем содержимым успешно удалена.`;
      }

      case 'list_dir': {
        const { fullPath, relPath, error } = await resolveSafePath(args.path || '.');
        if (error) {
          log('error', '✖ ' + error);
          return error;
        }

        if (!fsSync.existsSync(fullPath)) {
          log('error', `✖ Директория не найдена: ${relPath}`);
          return `Ошибка: Директория ${relPath} не найдена.`;
        }

        log('info', `📂 Просмотр папки: ${relPath}`);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = entries.map(e => `  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
        return `Содержимое папки ${relPath} (${entries.length} элементов):\n${items}`;
      }

      default:
        return `Ошибка: Неизвестный инструмент ${name}`;
    }
  } catch (err) {
    log('error', `✖ Ошибка при выполнении ${name}: ${err.message}`);
    return `Ошибка: ${err.message}`;
  }
}
