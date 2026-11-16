import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта модулей src/ (правило AGENTS.md, раздел 10)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-compact-test-'));
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

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const {
  needsCompaction,
  splitHistory,
  historyToText,
  compactHistory,
  dropOldHistory
} = await import('../src/agent/compactHistory.js');

test('needsCompaction: 79% -> false, 80% -> true, нет contextLength -> false, нет lastUsage -> false', () => {
  assert.strictEqual(
    needsCompaction({ contextLength: 10000, lastUsage: { total_tokens: 7900 } }),
    false,
    '79% не должно требовать сжатия'
  );
  assert.strictEqual(
    needsCompaction({ contextLength: 10000, lastUsage: { total_tokens: 8000 } }),
    true,
    '80% должно требовать сжатия'
  );
  assert.strictEqual(
    needsCompaction({ lastUsage: { total_tokens: 8000 } }),
    false,
    'Без contextLength сжатие не требуется'
  );
  assert.strictEqual(
    needsCompaction({ contextLength: 10000 }),
    false,
    'Без lastUsage сжатие не требуется'
  );
  assert.strictEqual(
    needsCompaction({ contextLength: 10000, lastUsage: null }),
    false,
    'С lastUsage: null сжатие не требуется'
  );
});

test('splitHistory: 4 хода с tool-вызовами -> old первые 2 хода, recent с 3-го хода; 2 хода -> old пустой', () => {
  const messages = [
    { role: 'user', content: 'Turn 1' },
    { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'list_dir', arguments: '{"path":"."}' } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'list_dir', content: 'dir items' },
    { role: 'assistant', content: 'Done 1' },

    { role: 'user', content: 'Turn 2' },
    { role: 'assistant', content: 'Done 2' },

    { role: 'user', content: 'Turn 3' },
    { role: 'assistant', tool_calls: [{ id: 'c2', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 'c2', name: 'read_file', content: 'file data' },
    { role: 'assistant', content: 'Done 3' },

    { role: 'user', content: 'Turn 4' },
    { role: 'assistant', content: 'Done 4' }
  ];

  const { old, recent } = splitHistory(messages);
  assert.strictEqual(old.length, 6);
  assert.strictEqual(old[0].role, 'user');
  assert.strictEqual(old[0].content, 'Turn 1');
  assert.strictEqual(old[4].role, 'user');
  assert.strictEqual(old[4].content, 'Turn 2');

  assert.strictEqual(recent.length, 6);
  assert.strictEqual(recent[0].role, 'user');
  assert.strictEqual(recent[0].content, 'Turn 3');
  assert.strictEqual(recent[4].role, 'user');
  assert.strictEqual(recent[4].content, 'Turn 4');

  // Проверка для 2 ходов: old должен быть пустым
  const twoTurns = messages.slice(6);
  const res2 = splitHistory(twoTurns);
  assert.deepStrictEqual(res2.old, []);
  assert.strictEqual(res2.recent.length, twoTurns.length);
  assert.strictEqual(res2.recent[0].content, 'Turn 3');
});

test('historyToText: обрезка tool-результата до 1500 символов, обрезка начала при maxChars, изображение', () => {
  // 1. Обрезка длинного tool-результата до 1500 символов
  const toolMsg = [{ role: 'tool', name: 'bash', content: 'x'.repeat(2500) }];
  const toolText = historyToText(toolMsg);
  assert.ok(toolText.includes('Результат bash: ' + 'x'.repeat(1500)));
  assert.ok(!toolText.includes('x'.repeat(1501)));

  // 2. Обрезка начала при maxChars
  const msgs = [
    { role: 'user', content: '1234567890' },
    { role: 'assistant', content: 'abcdefghij' }
  ];
  const full = historyToText(msgs);
  const maxChars = 12;
  const trimmed = historyToText(msgs, maxChars);
  assert.ok(trimmed.startsWith('[начало истории обрезано]\n'));
  assert.strictEqual(trimmed.slice('[начало истории обрезано]\n'.length), full.slice(full.length - maxChars));

  // 3. Изображение -> [изображение]
  const imgMsgs = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Посмотри на картинку: ' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
      ]
    }
  ];
  const imgText = historyToText(imgMsgs);
  assert.strictEqual(imgText, 'Пользователь: Посмотри на картинку: [изображение]');
});

test('compactHistory с подменённым fetch (SSE с content "Пересказ"): обновляет messages, lastUsage null, 1 запрос', async () => {
  const encoder = new TextEncoder();
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls++;
    const chunk = {
      choices: [
        {
          delta: {
            content: 'Пересказ'
          }
        }
      ]
    };
    return new Response(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        }
      }),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      }
    );
  };

  let onRequestCalls = 0;
  const initialMessages = [
    { role: 'user', content: 'Turn 1' },
    { role: 'assistant', content: 'Answer 1' },
    { role: 'user', content: 'Turn 2' },
    { role: 'assistant', content: 'Answer 2' },
    { role: 'user', content: 'Turn 3' },
    { role: 'assistant', content: 'Answer 3' }
  ];
  const session = {
    id: 'test-session',
    provider: 'openrouter',
    apiKey: 'test-api-key',
    model: 'test-model',
    contextLength: 32000,
    messages: [...initialMessages],
    lastUsage: { total_tokens: 30000 }
  };

  const res = await compactHistory(session, {
    onRequest: () => { onRequestCalls++; }
  });

  assert.strictEqual(res.compacted, true);
  assert.strictEqual(res.removed, 2);
  assert.strictEqual(onRequestCalls, 1);
  assert.strictEqual(fetchCalls, 1);
  assert.strictEqual(session.lastUsage, null);
  assert.strictEqual(session.messages.length, 6);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[0].content, '[Сжатая история предыдущего диалога]\n\nПересказ');
  assert.strictEqual(session.messages[1].role, 'assistant');
  assert.strictEqual(session.messages[1].content, 'Понял, продолжаю с учётом этой истории.');
  assert.deepStrictEqual(session.messages.slice(2), initialMessages.slice(2));
});

test('compactHistory при пустом old -> { compacted: false }, fetch не вызывался', async () => {
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls++;
    return new Response('{}', { status: 200 });
  };

  const session = {
    id: 'short-session',
    provider: 'openrouter',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Answer 2' }
    ]
  };

  const res = await compactHistory(session);
  assert.deepStrictEqual(res, { compacted: false });
  assert.strictEqual(fetchCalls, 0);
});

test('dropOldHistory оставляет только последние 2 хода', () => {
  const session = {
    messages: [
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Turn 3' },
      { role: 'assistant', content: 'Answer 3' }
    ],
    lastUsage: { total_tokens: 28000 }
  };

  const removed = dropOldHistory(session);
  assert.strictEqual(removed, 2);
  assert.strictEqual(session.lastUsage, null);
  assert.strictEqual(session.messages.length, 4);
  assert.strictEqual(session.messages[0].content, 'Turn 2');
  assert.strictEqual(session.messages[2].content, 'Turn 3');
});
