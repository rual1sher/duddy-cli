import OpenAI from 'openai';
import chalk from 'chalk';

export function createClient(apiKey) {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/duddy-cli',
      'X-Title': 'Duddy CLI'
    }
  });
}

/**
 * Stream a chat completion from OpenRouter with conciseness filters.
 */
export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  tools,
  maxTokens,
  temperature = 0.4,
  signal,
  onReasoning,
  onChunk
}) {
  if (!apiKey) {
    throw new Error('API key is not configured. Run /login to enter your OpenRouter key.');
  }

  const client = createClient(apiKey);

  const requestPayload = {
    model: model,
    messages: messages,
    temperature: temperature,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (maxTokens) {
    requestPayload.max_tokens = maxTokens;
  }
  if (tools && tools.length > 0) {
    requestPayload.tools = tools;
  }

  let stream;
  try {
    stream = await client.chat.completions.create(requestPayload, { signal });
  } catch (err) {
    // If model does not support tools/function calling, retry without tools
    if (requestPayload.tools && (
      err.message?.includes('tools') ||
      err.message?.includes('functions') ||
      err.message?.includes('not supported') ||
      err.message?.includes('No endpoints found')
    )) {
      delete requestPayload.tools;
      stream = await client.chat.completions.create(requestPayload, { signal });
    } else {
      throw err;
    }
  }

  let fullResponse = '';
  let inThinkBlock = false;
  let thinkBuffer = '';
  let inThinkingProcess = false;
  let usage = null;
  const toolCallsMap = {};

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = chunk.usage;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    // Accumulate tool calls if any
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap[idx]) {
          toolCallsMap[idx] = {
            id: tc.id || '',
            type: tc.type || 'function',
            function: {
              name: tc.function?.name || '',
              arguments: ''
            }
          };
        }
        if (tc.id) toolCallsMap[idx].id = tc.id;
        if (tc.function?.name) {
          toolCallsMap[idx].function.name = tc.function.name;
        }
        if (tc.function?.arguments) {
          toolCallsMap[idx].function.arguments += tc.function.arguments;
        }
      }
    }

    // Forward reasoning tokens (DeepSeek R1, Nemotron, etc.)
    if (delta.reasoning) {
      if (typeof onReasoning === 'function') {
        onReasoning(delta.reasoning);
      }
      continue;
    }

    if (delta.content) {
      let content = delta.content;

      // Suppress plain-text thinking process preamble (e.g. from Nemotron)
      if (!fullResponse && /Here\x27s a thinking process:/i.test(content)) {
        inThinkingProcess = true;
      }

      if (inThinkingProcess) {
        if (/\n\n(```|<!|[А-Яа-я#]|Here is|Вот)/.test(content)) {
          inThinkingProcess = false;
          content = content.replace(/^[\s\S]*?\n\n(?=```|<!|[А-Яа-я#]|Here is|Вот)/, '');
        } else {
          if (typeof onReasoning === 'function') onReasoning(content);
          continue;
        }
      }

      // Handle <think> ... </think> tags with sliding buffer
      if (content.includes('<think>')) {
        inThinkBlock = true;
        thinkBuffer = '';
        const parts = content.split('<think>');
        if (parts[0]) {
          fullResponse += parts[0];
          if (typeof onChunk === 'function') onChunk(parts[0]);
        }
        content = parts[1] || '';
      }

      if (inThinkBlock) {
        thinkBuffer += content;
        if (thinkBuffer.includes('</think>')) {
          inThinkBlock = false;
          const afterThink = thinkBuffer.split('</think>')[1] || '';
          thinkBuffer = '';
          content = afterThink;
        } else {
          if (typeof onReasoning === 'function') onReasoning(content);
          if (thinkBuffer.length > 50) {
            thinkBuffer = thinkBuffer.slice(-20);
          }
          continue;
        }
      }

      if (!content) continue;

      fullResponse += content;
      if (typeof onChunk === 'function') {
        onChunk(content);
      }
    }
  }

  const toolCalls = Object.values(toolCallsMap);

  return {
    content: fullResponse,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage
  };
}

/**
 * Получить актуальную информацию о ключе и доступных лимитах/остатке
 */
export async function fetchKeyInfo(apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/duddy-cli',
        'X-Title': 'Duddy CLI'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

let modelsContextCache = null;

/**
 * Получить максимальное окно контекста (лимит токенов) для модели
 */
export async function getModelContextLength(modelId = '') {
  if (!modelsContextCache) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const json = await res.json();
        modelsContextCache = {};
        for (const m of json.data || []) {
          if (m.id && m.context_length) {
            modelsContextCache[m.id] = m.context_length;
          }
        }
      }
    } catch {}
  }

  if (modelsContextCache && modelsContextCache[modelId]) {
    return modelsContextCache[modelId];
  }

  const m = (modelId || '').toLowerCase();
  if (m.includes('gemini') || m.includes('gemma')) return 1000000;
  if (m.includes('free')) return 200000;
  if (m.includes('claude')) return 200000;
  if (m.includes('gpt-4.1') || m.includes('o3') || m.includes('o1')) return 1000000;
  if (m.includes('gpt-4') || m.includes('llama')) return 128000;
  if (m.includes('deepseek')) return 64000;
  return 1000000;
}

