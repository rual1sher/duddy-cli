import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCompletion } from '../src/llm/stream.js';
import { catalogCache } from '../src/models/catalog.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  catalogCache.ollama = null;
});

function mockSSE(customProducer) {
  const encoder = new TextEncoder();
  let capturedUrl = '';
  let capturedBody = null;

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    if (init?.body) {
      try {
        capturedBody = JSON.parse(init.body);
      } catch {
        capturedBody = init.body;
      }
    }

    const stream = new ReadableStream({
      start(controller) {
        if (customProducer) {
          customProducer({
            send(obj) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            },
            close() {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  return {
    getRequest: () => ({ url: capturedUrl, body: capturedBody })
  };
}

test('для provider openrouter с reasoningEffort high полезная нагрузка содержит reasoning.effort', async () => {
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'openrouter',
    apiKey: 'test-or-key',
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'high'
  });

  const { body } = mock.getRequest();
  assert.deepStrictEqual(body.reasoning, { effort: 'high' });
  assert.strictEqual(body.reasoning_effort, undefined);
});

test('для provider ollama с reasoningEffort high полезная нагрузка содержит reasoning_effort', async () => {
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'deepseek-r1:14b',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'high'
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, 'high');
  assert.strictEqual(body.reasoning, undefined);
});

test('чанк с delta.reasoning_content вызывает колбэк onReasoning', async () => {
  mockSSE((sse) => {
    sse.send({ choices: [{ delta: { reasoning_content: 'Размышление' } }] });
    sse.send({ choices: [{ delta: { content: 'Результат' } }] });
    sse.close();
  });

  const reasoningChunks = [];
  const textChunks = [];

  const res = await streamChatCompletion({
    provider: 'openrouter',
    apiKey: 'test-key',
    model: 'deepseek/deepseek-r1',
    messages: [{ role: 'user', content: 'привет' }],
    onReasoning: (think) => reasoningChunks.push(think),
    onChunk: (text) => textChunks.push(text)
  });

  assert.ok(reasoningChunks.includes('Размышление'));
  assert.strictEqual(res.content, 'Результат');
});

test('для provider ollama с thinking: true и auto effort устанавливается reasoning_effort: none', async () => {
  catalogCache.ollama = [
    { id: 'qwen3:8b', name: 'Qwen 3 8B', thinking: true }
  ];
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'qwen3:8b',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'auto'
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, 'none');
  assert.strictEqual(body.reasoning, undefined);
});

test('для provider ollama с thinking: true и пустым reasoningEffort устанавливается reasoning_effort: none', async () => {
  catalogCache.ollama = [
    { id: 'qwen3:8b', name: 'Qwen 3 8B', thinking: true }
  ];
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'qwen3:8b',
    messages: [{ role: 'user', content: 'test' }]
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, 'none');
});

test('для provider ollama с thinking: false и auto effort параметр reasoning_effort не отправляется', async () => {
  catalogCache.ollama = [
    { id: 'llama3:8b', name: 'Llama 3 8B', thinking: false }
  ];
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'llama3:8b',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'auto'
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, undefined);
});

test('для provider ollama с неизвестным thinking и auto effort параметр reasoning_effort не отправляется', async () => {
  catalogCache.ollama = [];
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'unknown-model',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'auto'
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, undefined);
});

