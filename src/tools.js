import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

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
 * Normalizes and resolves a target path relative to current working directory
 */
function resolveSafePath(targetPath) {
  const fullPath = path.resolve(process.cwd(), targetPath || '.');
  const relPath = path.relative(process.cwd(), fullPath) || '.';
  return { fullPath, relPath };
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
    return { success: true, content: original.replace(oldContent, newContent), method: 'exact' };
  }

  const isCrlf = original.includes('\r\n');
  const normOriginal = original.replace(/\r\n/g, '\n');
  const normOld = oldContent.replace(/\r\n/g, '\n');
  const normNew = newContent.replace(/\r\n/g, '\n');

  // Tier 2: CRLF-normalized match
  if (normOriginal.includes(normOld)) {
    const res = normOriginal.replace(normOld, normNew);
    return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: 'crlf-normalized' };
  }

  // Tier 3: Whole-file match (trimmed)
  if (normOriginal.trim() === normOld.trim()) {
    return { success: true, content: isCrlf ? normNew.replace(/\n/g, '\r\n') : normNew, method: 'whole-file' };
  }

  // Tier 4: Trimmed edges match (leading/trailing newlines/spaces)
  const trimmedOld = normOld.trim();
  if (trimmedOld && normOriginal.includes(trimmedOld)) {
    const res = normOriginal.replace(trimmedOld, normNew.trim());
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
 * Execute a tool requested by the model autonomously without confirmation
 */
export async function executeTool(name, args = {}) {
  try {
    switch (name) {
      case 'create_file': {
        const pathError = validateFilePath(args.path, 'create_file');
        if (pathError) {
          console.log(chalk.red(`  ✖ ${pathError}`));
          return pathError;
        }

        const { fullPath, relPath } = resolveSafePath(args.path);
        const content = args.content ?? '';
        const exists = fsSync.existsSync(fullPath);

        if (exists) {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            console.log(chalk.red(`  ✖ Ошибка: "${relPath}" является папкой, а не файлом.`));
            return `Ошибка: Путь "${relPath}" является директорией, а не файлом. Укажите полное имя создаваемого файла, например "${relPath}/index.html".`;
          }
        }

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf8');
        console.log(chalk.green(`  ✔ Файл сохранен: ${chalk.bold(relPath)} (${content.length} байт)`));
        return `✓ Файл ${relPath} успешно сохранен (${content.length} байт).`;
      }

      case 'create_folder': {
        const { fullPath, relPath } = resolveSafePath(args.path);
        const exists = fsSync.existsSync(fullPath);

        if (exists) {
          console.log(chalk.dim(`  ℹ Папка ${relPath} уже существует.`));
          return `✓ Папка ${relPath} уже существует.`;
        }

        await fs.mkdir(fullPath, { recursive: true });
        console.log(chalk.green(`  ✔ Папка создана: ${chalk.bold(relPath)}`));
        return `✓ Папка ${relPath} успешно создана.`;
      }

      case 'read_file': {
        const pathError = validateFilePath(args.path, 'read_file');
        if (pathError) {
          console.log(chalk.red(`  ✖ ${pathError}`));
          return pathError;
        }

        const { fullPath, relPath } = resolveSafePath(args.path);
        if (!fsSync.existsSync(fullPath)) {
          console.log(chalk.red(`  ✖ Файл не найден: ${relPath}`));
          return `Ошибка: Файл ${relPath} не найден.`;
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return `Ошибка: Путь ${relPath} является папкой, а не файлом. Используйте list_dir.`;
        }

        console.log(chalk.hex('#38bdf8')(`  📖 Чтение файла: ${chalk.bold(relPath)}`));
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
          console.log(chalk.red(`  ✖ ${pathError}`));
          return pathError;
        }

        const { fullPath, relPath } = resolveSafePath(args.path);
        if (!fsSync.existsSync(fullPath)) {
          console.log(chalk.red(`  ✖ Файл не найден: ${relPath}`));
          return `Ошибка: Файл ${relPath} не существует. Чтобы создать его, используйте create_file.`;
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return `Ошибка: Путь "${relPath}" является директорией, а не файлом.`;
        }

        const oldContent = args.old_content ?? '';
        const newContent = args.new_content ?? '';

        if (!oldContent.trim()) {
          console.log(chalk.red(`  ✖ Параметр old_content пуст в ${relPath}`));
          return `Ошибка: Параметр old_content пуст. Для полной перезаписи файла используйте create_file(path: "${relPath}", content: "...").`;
        }

        const original = await fs.readFile(fullPath, 'utf8');
        const replaceResult = fuzzyReplace(original, oldContent, newContent);

        if (!replaceResult.success) {
          console.log(chalk.red(`  ✖ Фрагмент для замены не найден в ${relPath}`));
          return `Ошибка: Указанный old_content не найден в файле ${relPath}.
Подсказки для исправления:
1. Если вы хотите полностью перезаписать файл новым содержимым — вызовите инструмент create_file(path: "${relPath}", content: "...").
2. Для частичной замены сначала вызовите read_file, скопируйте точный непрерывный фрагмент строк из файла (включая отступы).`;
        }

        await fs.writeFile(fullPath, replaceResult.content, 'utf8');
        console.log(chalk.green(`  ✔ Файл обновлен: ${chalk.bold(relPath)}`));
        return `✓ Файл ${relPath} успешно изменен.`;
      }

      case 'delete_file': {
        const pathError = validateFilePath(args.path, 'delete_file');
        if (pathError) {
          console.log(chalk.red(`  ✖ ${pathError}`));
          return pathError;
        }

        const { fullPath, relPath } = resolveSafePath(args.path);
        if (!fsSync.existsSync(fullPath)) {
          console.log(chalk.red(`  ✖ Файл не найден: ${relPath}`));
          return `Ошибка: Файл ${relPath} не существует.`;
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return `Ошибка: Путь "${relPath}" является папкой. Для удаления папок используйте delete_folder.`;
        }

        await fs.unlink(fullPath);
        console.log(chalk.green(`  ✔ Файл удален: ${chalk.bold(relPath)}`));
        return `✓ Файл ${relPath} успешно удален.`;
      }

      case 'delete_folder': {
        const { fullPath, relPath } = resolveSafePath(args.path);
        if (!fsSync.existsSync(fullPath)) {
          console.log(chalk.red(`  ✖ Папка не найдена: ${relPath}`));
          return `Ошибка: Папка ${relPath} не существует.`;
        }

        const stats = await fs.stat(fullPath);
        if (!stats.isDirectory()) {
          return `Ошибка: Путь "${relPath}" является файлом. Для удаления файлов используйте delete_file.`;
        }

        if (fullPath === process.cwd() || relPath === '.') {
          return `Ошибка: Нельзя удалить корневую рабочую папку.`;
        }

        await fs.rm(fullPath, { recursive: true, force: true });
        console.log(chalk.green(`  ✔ Папка удалена: ${chalk.bold(relPath)}`));
        return `✓ Папка ${relPath} со всем содержимым успешно удалена.`;
      }

      case 'list_dir': {
        const { fullPath, relPath } = resolveSafePath(args.path || '.');
        if (!fsSync.existsSync(fullPath)) {
          console.log(chalk.red(`  ✖ Директория не найдена: ${relPath}`));
          return `Ошибка: Директория ${relPath} не найдена.`;
        }

        console.log(chalk.hex('#38bdf8')(`  📂 Просмотр папки: ${chalk.bold(relPath)}`));
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = entries.map(e => `  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
        return `Содержимое папки ${relPath} (${entries.length} элементов):\n${items}`;
      }

      default:
        return `Ошибка: Неизвестный инструмент ${name}`;
    }
  } catch (err) {
    console.log(chalk.red(`  ✖ Ошибка при выполнении ${name}: ${err.message}`));
    return `Ошибка: ${err.message}`;
  }
}
