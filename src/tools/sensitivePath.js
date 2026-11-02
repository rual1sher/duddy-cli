/** @fileoverview Определение путей с секретами, которые нельзя отдавать агенту без явного согласия */

import path from 'node:path';

const FORBIDDEN_PATHS = ['.config/duddy', 'duddy/checkpoints'];

const SENSITIVE_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.password-store']);

const SENSITIVE_PATHS = ['.config/gcloud', '.config/gh', '.docker/config.json', '.local/share/keyrings'];

const SENSITIVE_NAMES = new Set([
  '.envrc',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.pgpass',
  '.my.cnf',
  '.git-credentials',
  '.dockercfg',
  '.bash_history',
  '.zsh_history',
  '.psql_history',
  '.mysql_history',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  '.credentials.json',
  'oauth_creds.json',
  'auth.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml'
]);

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.ppk', '.jks', '.keystore', '.kdbx']);

const ENV_FILE = /^\.env(\..+)?$|^.+\.env$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;

/**
 * Проверяет один абсолютный путь
 *
 * @param {string} target - Абсолютный путь
 * @returns {'forbidden'|'sensitive'|null}
 */
function classifyOne(target) {
  const segments = target.toLowerCase().split(path.sep).filter(Boolean);
  const joined = `/${segments.join('/')}/`;
  const name = segments[segments.length - 1] || '';

  if (FORBIDDEN_PATHS.some(p => joined.includes(`/${p}/`))) {
    return 'forbidden';
  }

  const isSensitive =
    segments.some(s => SENSITIVE_DIRS.has(s)) ||
    SENSITIVE_PATHS.some(p => joined.includes(`/${p}/`)) ||
    SENSITIVE_NAMES.has(name) ||
    SENSITIVE_EXTENSIONS.has(path.extname(name)) ||
    (ENV_FILE.test(name) && !ENV_TEMPLATE.test(name));

  return isSensitive ? 'sensitive' : null;
}

/**
 * Определяет уровень доступа к пути. Проверяются и путь из запроса, и настоящий путь после
 * разрешения симлинков, иначе ссылка notes.txt -> .env обходила бы проверку.
 *
 * @param {...string} targets - Абсолютные пути
 * @returns {'forbidden'|'sensitive'|null} forbidden — запрещено всегда, sensitive — только с явным согласием
 */
export function classifyPath(...targets) {
  const levels = targets.filter(Boolean).map(classifyOne);
  if (levels.includes('forbidden')) return 'forbidden';
  if (levels.includes('sensitive')) return 'sensitive';
  return null;
}
