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
  maxTokens,
  temperature = 0.4,
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
  };
  if (maxTokens) {
    requestPayload.max_tokens = maxTokens;
  }

  const stream = await client.chat.completions.create(requestPayload);

  let fullResponse = '';
  let inThinkBlock = false;
  let inThinkingProcess = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Suppress separate internal monologue / reasoning stream
    if (delta.reasoning) {
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
          continue;
        }
      }

      // Handle <think> ... </think> tags if model emits them in content
      if (content.includes('<think>')) {
        inThinkBlock = true;
        content = content.replace(/<think>[\s\S]*$/, '');
      }

      if (inThinkBlock) {
        if (content.includes('</think>')) {
          inThinkBlock = false;
          content = content.replace(/^[\s\S]*<\/think>/, '');
        } else {
          continue;
        }
      }

      if (!content) continue;

      fullResponse += content;
      onChunk(content);
    }
  }

  return fullResponse;
}
