import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта модулей src/ (правило AGENTS.md, раздел 10)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-agent-req-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

after(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

const { runAgentTurn } = await import('../src/agent/agent.js');

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('runAgentTurn: два запроса при вызове инструмента (list_dir -> текст)', async () => {
  const encoder = new TextEncoder();
  let fetchCalls = 0;

  globalThis.fetch = () => {
    fetchCalls++;
    const step = fetchCalls;
    const stream = new ReadableStream({
      start(ctrl) {
        if (step === 1) {
          const chunk = {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'list_dir',
                        arguments: JSON.stringify({ path: '.' })
                      }
                    }
                  ]
                }
              }
            ]
          };
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        } else {
          const chunk = {
            choices: [
              {
                delta: {
                  content: 'Список файлов получен.'
                }
              }
            ]
          };
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        ctrl.close();
      }
    });

    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
  };

  const session = { provider: 'openrouter', apiKey: 'test', model: 'm', messages: [] };
  const toolCtx = { autoApprove: true, canPrompt: false };

  const res = await runAgentTurn({
    session,
    messages: [{ role: 'user', content: 'покажи файлы' }],
    toolCtx
  });

  assert.strictEqual(fetchCalls, 2);
  assert.strictEqual(res.requestCount, 2);
  assert.strictEqual(res.finalText, 'Список файлов получен.');
});

test('runAgentTurn: повтор при сетевом сбое (fetch failed) -> requestCount >= 2', async () => {
  const encoder = new TextEncoder();
  let fetchCalls = 0;

  globalThis.fetch = () => {
    fetchCalls++;
    if (fetchCalls === 1) {
      const err = new TypeError('fetch failed');
      err.cause = new Error('Connect Timeout Error');
      return Promise.reject(err);
    }

    const stream = new ReadableStream({
      start(ctrl) {
        const chunk = {
          choices: [
            {
              delta: {
                content: 'Успех после повтора'
              }
            }
          ]
        };
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        ctrl.close();
      }
    });

    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
  };

  const session = { provider: 'openrouter', apiKey: 'test', model: 'm', messages: [] };
  const toolCtx = { autoApprove: true, canPrompt: false };

  const res = await runAgentTurn({
    session,
    messages: [{ role: 'user', content: 'привет' }],
    toolCtx
  });

  assert.ok(fetchCalls >= 2, `fetchCalls (${fetchCalls}) должно быть >= 2`);
  assert.strictEqual(res.requestCount, fetchCalls);
  assert.ok(res.requestCount >= 2, `requestCount (${res.requestCount}) должно быть >= 2`);
  assert.strictEqual(res.finalText, 'Успех после повтора');
});
