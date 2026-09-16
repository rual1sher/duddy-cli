import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'openrouter/free',
  maxTokens: 750,
  temperature: 0.3,
  systemPrompt: `You are Duddy, a high-efficiency Linux, DevOps, and Full-Stack CLI assistant.
CRITICAL INSTRUCTIONS:
- Directly provide the exact command, code, or solution first.
- Zero conversational fluff (do NOT say 'Sure!', 'Here is how to do it', 'In this answer...').
- Provide at most 1-3 brief bullet points or sentences explaining the flags/mechanism.
- Quality and precision over length: do not write excessive tutorials or unwanted tables.
- Respond in the language used by the user.`
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (err) {
    // If parse error, fallback to defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(updates) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const current = loadConfig();
    const updated = { ...current, ...updates };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

export function getApiKey() {
  return process.env.OPENROUTER_API_KEY || loadConfig().apiKey;
}
