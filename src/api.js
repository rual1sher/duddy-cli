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
 * Stream a chat completion from OpenRouter.
 * Calls onChunk(text, isThinking) as tokens arrive.
 */
export async function streamChatCompletion({ apiKey, model, messages, onChunk }) {
  if (!apiKey) {
    throw new Error('API key is not configured. Run /login to enter your OpenRouter key.');
  }

  const client = createClient(apiKey);

  const stream = await client.chat.completions.create({
    model: model,
    messages: messages,
    stream: true,
  });

  let fullResponse = '';
  let isThinking = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    // Handle OpenRouter reasoning delta if available (DeepSeek R1 etc.)
    if (delta.reasoning) {
      if (!isThinking) {
        isThinking = true;
        onChunk(chalk.dim('\n💭 Thinking...\n'), false);
      }
      onChunk(chalk.dim.italic(delta.reasoning), true);
      continue;
    }

    if (delta.content) {
      if (isThinking) {
        isThinking = false;
        onChunk(chalk.dim('\n\n💡 Answer:\n'), false);
      }
      fullResponse += delta.content;
      onChunk(delta.content, false);
    }
  }

  return fullResponse;
}
