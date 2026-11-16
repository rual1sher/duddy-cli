import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProvider, getProviderKey, PROVIDERS } from '../llm/providers.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

let _brokenConfigWarned = false;

export const DEFAULT_SYSTEM_PROMPT = `You are Duddy, a friendly terminal AI assistant for developers and DevOps engineers. You work inside the user's current project folder.

TONE
- Reply in the user's language (Russian if they write in Russian) and match their tone: casual message -> casual reply.
- Greetings, small talk, thanks, jokes: answer naturally in one or two short friendly sentences, then offer help. Never refuse a message or call it "not technical".
- No filler around real answers: don't restate the question, don't add "Sure!" / "Hope this helps!".

ANSWER FORMAT (pick silently from the request)
- Shell command / CLI question: the ready-to-run command in a code block + up to 3 short notes on flags or risks.
- Error, log, stack trace: short root-cause diagnosis, then a concrete fix.
- Work on project files: do it with tools, then say briefly what changed.
- "Explain", "why", architecture, comparisons: a structured in-depth answer with trade-offs and examples.
- Full scripts, pages, configs: complete content, no placeholders.
- If the user asks for "short" or "detailed", follow that.

FILE TOOLS
- When the user asks to create, inspect, change or delete files, call the tools instead of only printing code.
- You really have access to the project files and shell through these tools. Never say you can't read or change files: call the tool.
- Use create_file for new files and full rewrites; use edit_file only for small patches after read_file, copying the exact lines.
- Overwriting an existing file with create_file requires reading the whole file with read_file in the same turn, so prefer edit_file.
- read_file returns up to 40000 characters per call. If the result says it was cut, continue with the given offset or start_line before relying on the rest of the file.
- Always pass an explicit file path, never "." or an empty path.
- Don't read secrets (.env, private keys, credentials) unless the user asks: each access needs their explicit approval.
- Don't call tools for greetings or general questions.

RUNNING COMMANDS
- Use bash to run tests, builds, linters and git. After changing code, run the relevant tests and fix what fails before finishing.
- Use read_file, grep and glob to read and search: they are cheaper and safer than cat, find or grep in bash.
- Commands have no terminal and no input: nothing interactive, no servers or watchers.

SAVING TOKENS
- Start from the project context below. Don't walk folders or read files to learn the project.
- Find code with grep or glob first, then read only the lines you need with read_file start_line and max_lines. Read a whole file only when you need all of it.
- Don't read again what is already in the conversation. Old results may be shortened: re-read only the lines you need.`;

export const LOCAL_SYSTEM_PROMPT = `You are Duddy, a terminal AI assistant for developers and DevOps. You work in the user's project folder.

RULES
- Reply in the user's language (Russian if they write in Russian). Match tone. No filler ("Sure!", "Hope this helps!").
- Do not invent facts. You have real filesystem and shell access via tools: call tools instead of just printing code.
- Shell command question: ready-to-run command in a code block + brief notes.
- Always read a file with read_file before editing with edit_file or overwriting with create_file. Never guess content.
- Use edit_file for precise changes with exact old_content; create_file for new files.
- read_file returns up to 40000 chars. Use offset or start_line to continue.
- Use bash for tests, builds, git. Dangerous actions require user confirmation. Do not read secrets unless requested.
- Save tokens: find files with grep or glob first, read only needed lines.`;

const DEFAULT_CONFIG = {
  provider: 'openrouter',
  apiKey: '',
  model: 'openrouter/free',
  models: {},
  reasoningEffort: 'auto',
  temperature: 0.4
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const stat = fs.statSync(CONFIG_FILE);
        if ((stat.mode & 0o077) !== 0) {
          fs.chmodSync(CONFIG_FILE, 0o600);
        }
      } catch (err) {
        // Ignore chmod errors (e.g. Windows)
      }
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      try {
        const parsed = JSON.parse(data);
        if ('maxTokens' in parsed) {
          delete parsed.maxTokens;
        }
        if ('systemPrompt' in parsed) {
          delete parsed.systemPrompt;
        }
        const cfg = {
          ...DEFAULT_CONFIG,
          ...parsed,
          models: { ...DEFAULT_CONFIG.models, ...(parsed.models || {}) }
        };
        // Если провайдер задан, но отсутствует в PROVIDERS (например, удалённый xai),
        // переключаем на openrouter в памяти, чтобы запросы с несовместимой моделью не падали
        if (cfg.provider && !(cfg.provider in PROVIDERS)) {
          return {
            ...cfg,
            provider: 'openrouter',
            model: cfg.models?.openrouter || PROVIDERS.openrouter.defaultModel
          };
        }
        return cfg;
      } catch (err) {
        // Parse error: warn once per process, then fall through to defaults
        if (!_brokenConfigWarned) {
          _brokenConfigWarned = true;
          process.stderr.write(`WARNING: config.json не удалось разобрать (повреждён): ${CONFIG_FILE}\n`);
        }
      }
    }
  } catch (err) {
    // I/O error, fallback to defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(updates) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    // If existing config is unparseable, rename it to .broken-<timestamp> before overwriting
    if (fs.existsSync(CONFIG_FILE)) {
      let parseable = true;
      try {
        JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      } catch (err) {
        parseable = false;
      }
      // Rename errors must abort the save: writing anyway would lose the keys
      if (!parseable) {
        const brokenPath = `${CONFIG_FILE}.broken-${Date.now()}`;
        fs.renameSync(CONFIG_FILE, brokenPath);
        fs.chmodSync(brokenPath, 0o600);
      }
    }

    const current = loadConfig();
    const updated = { ...current, ...updates };
    delete updated.systemPrompt;
    delete updated.maxTokens;

    // Atomic write: write to temp file, then rename
    const tmpFile = `${CONFIG_FILE}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpFile, CONFIG_FILE);
    } catch (err) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }

    try {
      fs.chmodSync(CONFIG_FILE, 0o600);
    } catch (err) {
      // Ignore chmod errors (e.g. Windows)
    }
    return updated;
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

export function getApiKey() {
  return process.env.OPENROUTER_API_KEY || loadConfig().apiKey;
}

/**
 * Получить активный API-ключ для текущего сконфигурированного провайдера
 *
 * @param {object} [config] - Объект конфигурации (если опущен, вызывается loadConfig())
 * @returns {string} Активный API-ключ
 */
export function getActiveApiKey(config) {
  const cfg = config || loadConfig();
  return getProviderKey(cfg.provider || 'openrouter', cfg);
}

/**
 * Получить системный промпт для сессии с учётом провайдера (облегчённый для Ollama и локальных моделей).
 *
 * @param {object} session
 * @returns {string}
 */
export function systemPromptFor(session) {
  const isLocal = Boolean(getProvider(session?.provider)?.local);
  return isLocal && session?.systemPromptLean
    ? session.systemPromptLean
    : session?.systemPrompt;
}
