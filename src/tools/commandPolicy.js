/** @fileoverview Классификация команд bash по степени риска */

import path from 'node:path';
import { classifyPath } from './sensitivePath.js';

// Без вопросов выполняются только команды, которые ничего не меняют и не выводят содержимое файлов.
// Шаблоны привязаны к началу и концу строки, поэтому составная команда под них не попадает
const SAFE_COMMANDS = [
  /^pwd$/,
  /^ls( -[a-zA-Z]+)*( [\w./-]+)?$/,
  /^git status( --short| -s| --porcelain| --branch| -b)*$/,
  /^git log( --oneline| --stat| -n ?\d+| -\d+)*$/,
  /^git diff( --stat| --staged| --cached| --name-only| --name-status)*$/,
  /^git branch( --show-current| -a| -v| -vv)*$/,
  /^(node|npm|git|rg|python3?) --version$/
];

const RISKY_PATTERNS = [
  { reason: 'повышение прав', re: /(^|[\s;&|(])(sudo|su|doas|pkexec)\s/ },
  { reason: 'рекурсивное или принудительное удаление', re: /\brm\s+(-\S+\s+)*-\S*[rRf]/ },
  { reason: 'массовое удаление', re: /\bfind\b.*\s-(delete|exec\s+rm)\b/ },
  { reason: 'необратимая операция git', re: /\bgit(\s+-\S+(\s+[^\s-]\S*)?)*\s+(push|clean|rebase|filter-branch|reset\s+--hard|checkout\s+--(?=\s|$)|restore|branch\s+-[dD]|stash\s+(drop|clear))(?=\s|$)/ },
  { reason: 'работа с диском', re: /\b(dd|mkfs\S*|fdisk|parted|wipefs|shred)\b/ },
  { reason: 'управление системой', re: /\b(shutdown|reboot|poweroff|systemctl|service|crontab|pacman|yay|apt|apt-get|dnf|yum|snap)\b/ },
  { reason: 'изменение прав', re: /\b(chown\b|chmod\s+(-R|--recursive|777))/ },
  { reason: 'завершение процессов', re: /\b(kill|pkill|killall)\b/ },
  { reason: 'сеть', re: /\b(curl|wget|nc|ncat|ssh|scp|sftp|rsync|ftp|telnet)\b/ },
  { reason: 'публикация', re: /\b(npm|yarn|pnpm)\s+publish\b|\bdocker\s+push\b/ },
  { reason: 'выполнение кода из строки', re: /\beval\b|\bbase64\s+(-d|--decode)\b|\b(python3?|node|perl|ruby|php|bash|sh|zsh)\s+(-c|-e)\b/ },
  { reason: 'запись вне рабочей папки', re: /(>|\btee\s+(-a\s+)?)\s*(\/(?!dev\/null\b)|~|\$HOME)/ },
  { reason: 'закрепление в системе', re: /\.git\/hooks|\.(bash|zsh)rc\b|\.bash_profile\b|\.profile\b/ },
  { reason: 'форк-бомба', re: /:\s*\(\s*\)\s*\{/ },
  { reason: 'имя команды вычисляется при запуске', re: /(^|[;&|]\s*)(\$|`)/ },
  { reason: 'маска может захватить скрытые файлы с секретами', re: /(^|[\s/])\.[\w-]*[*?[]/ }
];

/**
 * Находит в команде упоминания защищённых путей. Это страховка от случайностей, а не граница:
 * обфусцированный путь проверка не поймает, поэтому граница здесь — подтверждение пользователя.
 *
 * @param {string} command - Текст команды
 * @param {string} cwd - Рабочая папка
 * @returns {'forbidden'|'sensitive'|null}
 */
function classifyMentionedPaths(command, cwd) {
  const tokens = command.split(/[\s'"=:;|&<>()]+/).filter(Boolean);
  const levels = tokens.map(token => classifyPath(path.resolve(cwd, token)));
  if (levels.includes('forbidden')) return 'forbidden';
  if (levels.includes('sensitive')) return 'sensitive';
  return null;
}

/**
 * Определяет, как обращаться с командой.
 *
 * @param {string} command - Текст команды
 * @param {string} cwd - Рабочая папка
 * @returns {{ level: 'forbidden'|'dangerous'|'safe'|'ask', reason?: string }}
 */
export function classifyCommand(command, cwd) {
  const trimmed = command.trim();
  // Кавычки и экранирование не меняют смысл для bash, но скрыли бы "rm" и r\m от проверок
  const plain = trimmed.replace(/["'\\]/g, '');

  const mentioned = classifyMentionedPaths(plain, cwd);
  if (mentioned === 'forbidden') {
    return { level: 'forbidden', reason: 'настройки duddy с API-ключами и резервные копии' };
  }
  if (mentioned === 'sensitive') {
    return { level: 'dangerous', reason: 'файл, который может содержать секреты' };
  }

  const risky = RISKY_PATTERNS.find(({ re }) => re.test(plain));
  if (risky) {
    return { level: 'dangerous', reason: risky.reason };
  }

  if (SAFE_COMMANDS.some(re => re.test(trimmed))) {
    return { level: 'safe' };
  }
  return { level: 'ask' };
}
