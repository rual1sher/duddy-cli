/** @fileoverview Поиск секретов в содержимом файлов, которые не определяются по имени */

const PLACEHOLDER = /^(your|my|change|replace|example|sample|test|dummy|fake|placeholder|xxx|\*\*\*|null|none|true|false|undefined|process\.|os\.|env\.|getenv)/i;

const PATTERNS = [
  { label: 'приватный ключ', re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g },
  { label: 'ключ AWS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'токен GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { label: 'токен GitLab', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { label: 'токен Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'ключ Stripe', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
  { label: 'токен Telegram', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { label: 'ключ API', re: /\b(?:sk-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})/g },
  {
    label: 'пароль в адресе подключения',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s:/@'"$<{]+)@[^\s'"]+/gi,
    value: 1
  },
  {
    label: 'секрет в переменной',
    re: /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*[ \t]*[=:][ \t]*['"]?([^\s'"$<{#]{8,})/gm,
    value: 1
  }
];

/**
 * Находит в тексте значения, похожие на настоящие секреты. Сами значения не возвращаются:
 * результат показывается пользователю и не должен их раскрывать.
 *
 * @param {string} text - Проверяемый текст
 * @returns {Array<{ label: string, line: number }>} Первая находка каждого вида, line считается с 1
 */
export function scanSecrets(text) {
  const findings = [];
  for (const { label, re, value } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      const isPlaceholder = value !== undefined && PLACEHOLDER.test(match[value]);
      if (!isPlaceholder) {
        findings.push({ label, line: text.slice(0, match.index).split('\n').length });
        break;
      }
    }
  }
  return findings;
}
