import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'openrouter/free',
  maxTokens: 750,
  temperature: 0.4,
  systemPrompt: `You are Duddy, an intelligent and versatile terminal AI assistant.
GUIDELINES:
1. ADAPT TO INTENT:
   - For technical, devops, and coding tasks: be direct, sharp, and concise. Give the exact command or code first, followed by 1-3 essential notes on flags/behavior. Avoid conversational filler.
   - For creative, conceptual, narrative, or open-ended questions (e.g. game plots, stories, ideas, explanations): answer naturally, creatively, and engagingly in normal flowing prose or fitting story structure, without forcing dry bullet-point checklists unless requested.
2. FORMATTING:
   - Use clean Markdown with headers, code blocks, or bullets where appropriate.
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
