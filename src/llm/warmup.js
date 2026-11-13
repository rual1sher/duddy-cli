/** @fileoverview Фоновый прогрев локальной модели для кэширования префикса промпта в Ollama */

import { createClient } from './client.js';
import { buildRequestPayload } from './payload.js';
import { toolsForMode } from '../modes.js';
import { AGENT_TOOLS } from '../tools/definitions.js';
import { systemPromptFor } from '../config.js';
import { getProvider } from '../providers.js';
import { ensureLocalModelInfo } from '../models/catalog.js';

/**
 * Прогревает локальную модель в фоне одним запросом с max_tokens: 1,
 * чтобы Ollama загрузила веса и закэшировала начало системного промпта.
 *
 * @param {object} session - Сессия Duddy
 * @param {object} [options]
 * @param {string} [options.mode='default'] - Режим разрешений
 * @returns {Promise<boolean>}
 */
export async function warmupLocalModel(session, { mode = 'default' } = {}) {
  const providerConfig = getProvider(session?.provider);
  if (!providerConfig?.local || !session?.model) {
    return false;
  }

  try {
    await ensureLocalModelInfo(session.model);
    const client = createClient(session.apiKey || 'ollama', providerConfig.id);
    const tools = toolsForMode(AGENT_TOOLS, mode);
    const payload = buildRequestPayload({
      model: session.model,
      messages: [
        { role: 'system', content: systemPromptFor(session) },
        { role: 'user', content: '.' }
      ],
      tools,
      temperature: session.temperature ?? 0.4,
      maxTokens: 1,
      reasoningEffort: session.reasoningEffort || 'auto',
      provider: providerConfig.id,
      sessionId: session.id,
      stream: false
    });

    await client.chat.completions.create(payload);
    return true;
  } catch {
    return false;
  }
}
