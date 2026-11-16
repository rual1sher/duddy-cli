import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCompletion } from '../src/llm/stream.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockSSE(producer) {
  const encoder = new TextEncoder();
  globalThis.fetch = (url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        if (init?.signal) {
          if (init.signal.aborted) {
            controller.error(init.signal.reason || new Error('Aborted'));
            return;
          }
          init.signal.addEventListener('abort', () => {
            controller.error(init.signal.reason || new Error('Aborted'));
          });
        }
        producer({
          send(obj) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          },
          close() {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }, init?.signal);
      }
    });

    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
  };
}

test('чанки идут нормально → успешный результат', async () => {
  mockSSE(async (sse) => {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 10));
      sse.send({ choices: [{ delta: { content: String(i) } }] });
    }
    sse.close();
  });

  const res = await streamChatCompletion({
    provider: 'openrouter',
    apiKey: 'test',
    model: 'm',
    messages: []
  });

  assert.strictEqual(res.content, '0123');
});

test('внешний AbortController.abort() посреди потока → reject с name AbortError', async () => {
  const ac = new AbortController();

  mockSSE((sse) => {
    sse.send({ choices: [{ delta: { content: 'Начало' } }] });
    setTimeout(() => {
      ac.abort();
    }, 10);
  });

  await assert.rejects(
    async () => {
      await streamChatCompletion({
        provider: 'openrouter',
        apiKey: 'test',
        model: 'm',
        messages: [],
        signal: ac.signal
      });
    },
    (err) => {
      assert.strictEqual(err.name, 'AbortError');
      assert.strictEqual(err.code, undefined);
      return true;
    }
  );
});
