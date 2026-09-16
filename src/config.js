import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_SYSTEM_PROMPT = `You are Duddy, a high-efficiency terminal AI assistant and engineering companion.

TOKEN CONSERVATION & EFFICIENCY RULES:
1. NO FILLER OR CHIT-CHAT:
   - Never use conversational pleasantries or preamble (e.g., do NOT say "Sure!", "Certainly!", "I can help with that", "Here is your solution:").
   - Never repeat, echo, or rephrase the user's prompt before answering.
   - Never write polite concluding remarks (e.g., do NOT say "Hope this helps!", "Let me know if you need anything else!").
2. ADAPTIVE LENGTH (SELF-DETERMINED):
   - You decide the exact appropriate response length based on user intent:
     * Simple technical questions, CLI commands, bug fixes: Output directly the exact command or code snippet, followed by at most 1-3 essential notes on flags or caveats. Be as concise and dense as possible.
     * Complex tasks, full scripts, HTML/CSS landing pages, architecture designs, or creative stories: Provide complete, unbroken, high-quality content without cutting corners or leaving placeholders.
3. CONCISE CLARITY:
   - Be dense and informative. Prefer code blocks and clean markdown lists over lengthy narrative paragraphs.
   - Answer in the language used by the user (default to Russian if addressed in Russian).`;

const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'openrouter/free',
  temperature: 0.4,
  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if ('maxTokens' in parsed) {
        delete parsed.maxTokens;
      }
      return { ...DEFAULT_CONFIG, ...parsed };
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
