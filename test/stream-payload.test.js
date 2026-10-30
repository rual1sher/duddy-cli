import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCompletion } from '../src/llm/stream.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

test('для provider xai с reasoningEffort high полезная нагрузка содержит reasoning_effort и правильный baseURL', async () => {
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'xai',
    apiKey: 'test-xai-key',
    model: 'grok-4.7',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'high'
  });

  const { url, body } = mock.getRequest();
  assert.ok(url.startsWith('https://api.x.ai/v1'));
  assert.strictEqual(body.reasoning_effort, 'high');
  assert.strictEqual(body.reasoning, undefined);
});

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

test('для provider google с reasoningEffort high полезная нагрузка содержит reasoning_effort', async () => {
  const mock = mockSSE();

  await streamChatCompletion({
    provider: 'google',
    apiKey: 'test-google-key',
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'test' }],
    reasoningEffort: 'high'
  });

  const { body } = mock.getRequest();
  assert.strictEqual(body.reasoning_effort, 'high');
  assert.strictEqual(body.reasoning, undefined);
});

test('чанк с delta.reasoning_content вызывает колбэк onReasoning', async () => {
  mockSSE((sse) => {
    sse.send({ choices: [{ delta: { reasoning_content: 'Размышление xAI' } }] });
    sse.send({ choices: [{ delta: { content: 'Результат' } }] });
    sse.close();
  });

  const reasoningChunks = [];
  const textChunks = [];

  const res = await streamChatCompletion({
    provider: 'xai',
    apiKey: 'test-key',
    model: 'grok-4.7',
    messages: [{ role: 'user', content: 'привет' }],
    onReasoning: (think) => reasoningChunks.push(think),
    onChunk: (text) => textChunks.push(text)
  });

  assert.ok(reasoningChunks.includes('Размышление xAI'));
  assert.strictEqual(res.content, 'Результат');
});
