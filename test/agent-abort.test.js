import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn } from '../src/agent.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('отмена после первого вызова инструмента отклоняет второй вызов и прерывает ход', async () => {
  const encoder = new TextEncoder();
  const controller = new AbortController();

  let fetchCallCount = 0;
  globalThis.fetch = (url, init) => {
    fetchCallCount++;
    if (init?.signal?.aborted) {
      const abortErr = new Error('Request was aborted.');
      abortErr.name = 'AbortError';
      return Promise.reject(abortErr);
    }

    const stream = new ReadableStream({
      start(ctrl) {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            ctrl.error(init.signal.reason || new Error('Aborted'));
          });
        }
        const chunk = {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'list_dir', arguments: '{"path":"."}' }
                  },
                  {
                    index: 1,
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'list_dir', arguments: '{"path":"."}' }
                  }
                ]
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

  const session = { provider: 'google', apiKey: 'test', model: 'm' };
  const toolCtx = { autoApprove: true, canPrompt: false };
  let toolResultCount = 0;

  await assert.rejects(
    async () => {
      await runAgentTurn({
        session,
        messages: [{ role: 'user', content: 'list files' }],
        toolCtx,
        signal: controller.signal,
        events: {
          onToolResult: () => {
            toolResultCount++;
            if (toolResultCount === 1) {
              controller.abort();
            }
          }
        }
      });
    },
    (err) => {
      assert.strictEqual(err.name, 'AbortError');
      assert.strictEqual(toolResultCount, 2);
      assert.ok(Array.isArray(err.partialMessages));
      assert.strictEqual(err.partialMessages.length, 3);

      const assistantMsg = err.partialMessages[0];
      assert.strictEqual(assistantMsg.role, 'assistant');
      assert.strictEqual(assistantMsg.tool_calls.length, 2);

      const tool1 = err.partialMessages[1];
      assert.strictEqual(tool1.role, 'tool');
      assert.strictEqual(tool1.tool_call_id, 'call_1');

      const tool2 = err.partialMessages[2];
      assert.strictEqual(tool2.role, 'tool');
      assert.strictEqual(tool2.tool_call_id, 'call_2');
      assert.ok(tool2.content.startsWith('Отклонено'), `Expected tool2 to start with 'Отклонено', got: ${tool2.content}`);

      return true;
    }
  );
});

test('обрыв fetch-потока после текстового чанка сохраняет частичный ответ', async () => {
  const encoder = new TextEncoder();

  globalThis.fetch = (url, init) => {
    const stream = new ReadableStream({
      start(ctrl) {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            ctrl.error(init.signal.reason || new Error('Aborted'));
          });
        }
        const chunk = {
          choices: [
            {
              delta: {
                content: 'Начало ответа'
              }
            }
          ]
        };
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        // Разрыв потока ошибкой
        setTimeout(() => {
          ctrl.error(new Error('Network drop'));
        }, 10);
      }
    });

    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
  };

  const session = { provider: 'google', apiKey: 'test', model: 'm' };
  const toolCtx = { autoApprove: true, canPrompt: false };

  await assert.rejects(
    async () => {
      await runAgentTurn({
        session,
        messages: [{ role: 'user', content: 'hello' }],
        toolCtx
      });
    },
    (err) => {
      assert.ok(Array.isArray(err.partialMessages));
      const partial = err.partialMessages;
      assert.strictEqual(partial.length, 1);
      assert.strictEqual(partial[0].role, 'assistant');
      assert.strictEqual(partial[0].content, 'Начало ответа\n\n(ответ оборван)');
      return true;
    }
  );
});
