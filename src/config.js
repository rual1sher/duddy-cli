import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProviderKey } from './providers.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
- Use create_file for new files and full rewrites; use edit_file only for small patches after read_file, copying the exact lines.
- Always pass an explicit file path, never "." or an empty path.
- Don't call tools for greetings or general questions.`;

const DEFAULT_CONFIG = {
  provider: 'openrouter',
  apiKey: '',
  googleApiKey: '',
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
      const parsed = JSON.parse(data);
      if ('maxTokens' in parsed) {
        delete parsed.maxTokens;
      }
      if ('systemPrompt' in parsed) {
        delete parsed.systemPrompt;
      }
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        models: { ...DEFAULT_CONFIG.models, ...(parsed.models || {}) }
      };
    }
  } catch (err) {
    // If parse error, fallback to defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(updates) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    const current = loadConfig();
    const updated = { ...current, ...updates };
    delete updated.systemPrompt;
    delete updated.maxTokens;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600 });
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
