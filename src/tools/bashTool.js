/** @fileoverview Инструмент bash: запуск команд в рабочей папке */

import { spawn } from 'node:child_process';
import { requestApproval } from './approval.js';
import { classifyCommand } from './commandPolicy.js';
import { scanSecrets } from './secretScan.js';

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
// Хвост важнее начала: итог тестов и сборки печатается в конце
const HEAD_CHARS = 3000;
const TAIL_CHARS = 9000;
const KILL_GRACE_MS = 2000;
const CLOSE_GRACE_MS = 500;
const PREVIEW_LINES = 12;
const TITLE_CHARS = 80;

const SECRET_ENV = /API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|ACCESS_?KEY/i;
const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Собирает окружение команды. Ключи убираются: иначе их покажет простой `env`,
 * а вывод уходит модели и провайдеру.
 *
 * @returns {object}
 */
function buildEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!SECRET_ENV.test(name)) {
      env[name] = value;
    }
  }
  return { ...env, CI: '1', NO_COLOR: '1', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
}

/**
 * Хранит начало и конец вывода: `yes` или большой лог не должны занять всю память.
 *
 * @returns {{ add: (text: string) => void, read: () => string }}
 */
function createOutputBuffer() {
  let head = '';
  let tail = '';
  let total = 0;

  return {
    add(text) {
      total += text.length;
      const room = HEAD_CHARS - head.length;
      if (room > 0) {
        head += text.slice(0, room);
        text = text.slice(room);
      }
      tail = (tail + text).slice(-TAIL_CHARS);
    },
    read() {
      const skipped = total - head.length - tail.length;
      const middle = skipped > 0 ? `\n...[Пропущено ${skipped} символов из середины вывода]...\n` : '';
      return `${head}${middle}${tail}`.replace(ANSI_SEQUENCE, '').replace(/\r\n?/g, '\n').trimEnd();
    }
  };
}

/**
 * Запускает команду в отдельной группе процессов: `npm test` порождает дочерние процессы,
 * и завершить надо всех, а не только bash.
 *
 * @param {string} command - Текст команды
 * @param {number} timeoutMs - Лимит времени
 * @param {AbortSignal} [signal] - Отмена пользователем
 * @returns {Promise<{ code: number|null, output: string, timedOut: boolean, aborted: boolean, error: Error|null }>}
 */
function runCommand(command, timeoutMs, signal) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      env: buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const buffer = createOutputBuffer();
    let timedOut = false;
    let aborted = false;
    let exitCode = null;
    let killTimer = null;
    let closeTimer = null;
    let settled = false;

    const signalGroup = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch {
        // Группа уже завершилась
      }
    };
    const stopGroup = () => {
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => {
      aborted = true;
      stopGroup();
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, timeoutMs);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      signal?.removeEventListener('abort', onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: exitCode, output: buffer.read(), timedOut, aborted, error });
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', buffer.add);
    child.stderr.on('data', buffer.add);

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      exitCode = code;
      // Фоновый процесс команды держал бы вывод открытым и остался бы работать после хода
      signalGroup('SIGTERM');
      closeTimer = setTimeout(() => finish(null), CLOSE_GRACE_MS);
    });
    child.on('close', () => finish(null));
  });
}

/**
 * Разбирает лимит времени из аргументов модели.
 *
 * @param {unknown} value - Значение timeout_seconds
 * @returns {number} Секунды в допустимых границах
 */
function parseTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(seconds, MAX_TIMEOUT_SECONDS);
}

/**
 * Строит подпись и предпросмотр команды для диалога подтверждения.
 *
 * @param {string} command - Текст команды
 * @param {string} [reason] - Почему команда опасна
 * @returns {{ title: string, preview: Array<object> }}
 */
function describeCommand(command, reason) {
  const lines = command.split('\n');
  const firstLine = lines[0];
  const title = firstLine.length > TITLE_CHARS || lines.length > 1 ? `${firstLine.slice(0, TITLE_CHARS)}…` : firstLine;

  const preview = [{ kind: 'info', text: `Папка: ${process.cwd()}` }];
  if (reason) {
    preview.push({ kind: 'warn', text: `Опасная команда: ${reason}. Спрашивается каждый раз.` });
  }
  for (const line of lines.slice(0, PREVIEW_LINES)) {
    preview.push({ kind: 'add', text: line });
  }
  if (lines.length > PREVIEW_LINES) {
    preview.push({ kind: 'info', text: `… ещё ${lines.length - PREVIEW_LINES} строк` });
  }
  return { title, preview };
}

/**
 * Получает разрешение на запуск. Флаг --yes покрывает обычные команды, но не опасные.
 * Выбор «на всю сессию» для файлов команды не покрывает: у bash нет границы рабочей папки.
 *
 * @param {string} command - Текст команды
 * @param {{ level: string, reason?: string }} policy - Решение classifyCommand
 * @param {object} ctx - Контекст инструмента
 * @returns {Promise<{ approved: boolean, message?: string }>}
 */
async function approveCommand(command, policy, ctx) {
  if (policy.level === 'safe') {
    return { approved: true };
  }

  const { title, preview } = describeCommand(command, policy.reason);
  if (policy.level === 'dangerous') {
    return requestApproval('bash', title, ctx, preview, {
      sensitive: true,
      deniedMessage: `Отклонено: опасная команда (${policy.reason}), нужно явное подтверждение в интерактивном режиме. Флаг --yes его не заменяет.`
    });
  }

  if (ctx.allowCommands || ctx.allowedCommands?.has(command)) {
    return { approved: true };
  }
  return requestApproval('bash', title, ctx, preview, {
    commandKey: command,
    deniedMessage: 'Отклонено: команда требует подтверждения, но интерактивный ввод недоступен (запустите duddy с флагом --yes, чтобы разрешить обычные команды).'
  });
}

/**
 * Оформляет итог запуска для модели.
 *
 * @param {object} result - Итог runCommand
 * @param {number} timeoutSeconds - Лимит времени
 * @returns {string}
 */
function formatResult({ code, output, timedOut, aborted }, timeoutSeconds) {
  const body = output ? `\n${output}` : '';
  if (aborted) return `Отклонено: команда прервана пользователем${body}`;
  if (timedOut) return `Ошибка: команда остановлена по таймауту ${timeoutSeconds} с${body}`;
  if (code !== 0) return `Ошибка: код выхода ${code ?? 'неизвестен'}${body}`;
  return output || '(команда завершилась без вывода)';
}

/**
 * Выполняет команду bash по запросу модели.
 *
 * @param {object} args
 * @param {string} args.command - Текст команды
 * @param {number} [args.timeout_seconds] - Лимит времени
 * @param {object} ctx - Контекст инструмента
 * @param {Function} log - Функция лога
 * @param {object} [meta={}] - meta.secret: вывод нельзя оставлять в истории
 * @returns {Promise<string>}
 */
export async function runBash(args, ctx, log, meta = {}) {
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) {
    return 'Ошибка: не указана команда.';
  }

  const policy = classifyCommand(command, process.cwd());
  if (policy.level === 'forbidden') {
    const denied = `Ошибка: Доступ запрещён — команда обращается к защищённым данным: ${policy.reason}.`;
    log('error', `✖ ${denied}`);
    return denied;
  }

  const approval = await approveCommand(command, policy, ctx);
  if (!approval.approved) {
    return approval.message;
  }

  const timeoutSeconds = parseTimeout(args.timeout_seconds);
  const result = await runCommand(command, timeoutSeconds * 1000, ctx.signal);
  if (result.error) {
    return `Ошибка: не удалось запустить bash: ${result.error.message}`;
  }

  // Секрет определяется по выводу до отправки модели: команда могла вывести его как угодно
  const findings = scanSecrets(result.output);
  if (findings.length > 0) {
    const preview = [
      { kind: 'warn', text: 'В выводе команды похоже на секрет. Если разрешить, его увидят модель и провайдер' },
      ...findings.map(f => ({ kind: 'warn', text: `${f.label}, строка ${f.line}` }))
    ];
    const shown = await requestApproval('bash', 'показать вывод модели', ctx, preview, {
      sensitive: true,
      deniedMessage: 'Отклонено: вывод команды похож на секрет и не показан. Команда выполнена.'
    });
    if (!shown.approved) {
      const status = result.code === 0 ? 'Команда выполнена' : `Команда завершилась с кодом ${result.code}`;
      return `Отклонено: ${status}, но вывод похож на секрет и не показан.`;
    }
    meta.secret = true;
  }

  return formatResult(result, timeoutSeconds);
}
