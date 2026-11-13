import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractTextToolCalls } from '../src/llm/textToolCalls.js';
import { AGENT_TOOLS } from '../src/tools/definitions.js';
import { runAgentTurn } from '../src/agent.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('Формат 1: minicpm <function name="..."><param name="...">...</param></function>', () => {
  const content = 'Начинаю чтение:\n<function name="read_file"><param name="path">src/app.js</param></function>\nГотово.';
  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, '');
  assert.equal(calls[0].type, 'function');
  assert.equal(calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/app.js' });
  assert.equal(rest, 'Начинаю чтение:\n\nГотово.');
});

test('Формат 2: qwen3-coder <function=...><parameter=...>...</parameter></function> с обрезкой переводов строк', () => {
  const content = `<function=read_file>
<parameter=path>
src/index.js
</parameter>
</function>`;
  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/index.js' });
  assert.equal(rest, '');
});

test('Формат 3: hermes/qwen <tool_call>{"name": "...", "arguments": {...}}</tool_call> и parameters', () => {
  const withArgs = '<tool_call>{"name": "read_file", "arguments": {"path": "src/a.js"}}</tool_call>';
  const res1 = extractTextToolCalls(withArgs, AGENT_TOOLS);
  assert.equal(res1.calls.length, 1);
  assert.equal(res1.calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(res1.calls[0].function.arguments), { path: 'src/a.js' });
  assert.equal(res1.rest, '');

  const withParams = '<tool_call>{"name": "read_file", "parameters": {"path": "src/b.js"}}</tool_call>';
  const res2 = extractTextToolCalls(withParams, AGENT_TOOLS);
  assert.equal(res2.calls.length, 1);
  assert.equal(res2.calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(res2.calls[0].function.arguments), { path: 'src/b.js' });
  assert.equal(res2.rest, '');
});

test('Формат 4: одиночный JSON-объект целиком или внутри fenced-блока ```json', () => {
  const rawJson = '{"name": "read_file", "arguments": {"path": "src/main.js"}}';
  const resRaw = extractTextToolCalls(rawJson, AGENT_TOOLS);
  assert.equal(resRaw.calls.length, 1);
  assert.equal(resRaw.calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(resRaw.calls[0].function.arguments), { path: 'src/main.js' });
  assert.equal(resRaw.rest, '');

  const fencedJson = '```json\n{\n  "name": "read_file",\n  "arguments": {\n    "path": "src/fenced.js"\n  }\n}\n```';
  const resFenced = extractTextToolCalls(fencedJson, AGENT_TOOLS);
  assert.equal(resFenced.calls.length, 1);
  assert.equal(resFenced.calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(resFenced.calls[0].function.arguments), { path: 'src/fenced.js' });
  assert.equal(resFenced.rest, '');
});

test('CDATA: значения параметров могут быть обёрнуты в <![CDATA[ ... ]]>', () => {
  const content = '<function name="create_file"><param name="path"><![CDATA[src/temp.txt]]></param><param name="content"><![CDATA[line 1\n<special> & tag]]></param></function>';
  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'create_file');
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.path, 'src/temp.txt');
  assert.equal(args.content, 'line 1\n<special> & tag');
  assert.equal(rest, '');
});

test('integer coercion для read_file start_line и max_lines', () => {
  const content1 = '<function name="read_file"><param name="path">src/app.js</param><param name="start_line">42</param><param name="max_lines">100</param></function>';
  const res1 = extractTextToolCalls(content1, AGENT_TOOLS);
  assert.equal(res1.calls.length, 1);
  const args1 = JSON.parse(res1.calls[0].function.arguments);
  assert.strictEqual(args1.start_line, 42);
  assert.strictEqual(args1.max_lines, 100);
  assert.strictEqual(args1.path, 'src/app.js');

  const content2 = '<function=read_file><parameter=path>src/app.js</parameter><parameter=start_line>50</parameter></function>';
  const res2 = extractTextToolCalls(content2, AGENT_TOOLS);
  assert.equal(res2.calls.length, 1);
  const args2 = JSON.parse(res2.calls[0].function.arguments);
  assert.strictEqual(args2.start_line, 50);
});

test('неизвестное имя инструмента игнорируется', () => {
  const content = '<function name="unknown_danger_tool"><param name="foo">bar</param></function>';
  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 0);
  assert.equal(rest, content);

  const contentFenced = '```json\n{"name": "not_a_tool", "arguments": {}}\n```';
  const resFenced = extractTextToolCalls(contentFenced, AGENT_TOOLS);
  assert.equal(resFenced.calls.length, 0);
  assert.equal(resFenced.rest, contentFenced);
});

test('битый JSON игнорируется', () => {
  const content = '<tool_call>{"name": "read_file", "arguments": {broken_json</tool_call>';
  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 0);
  assert.equal(rest, content);

  const rawBroken = '{"name": "read_file", "arguments": {bad';
  const resRaw = extractTextToolCalls(rawBroken, AGENT_TOOLS);
  assert.equal(resRaw.calls.length, 0);
  assert.equal(resRaw.rest, rawBroken);
});

test('простой текст возвращает пустой список вызовов и неизменённый rest', () => {
  const plain = 'Привет! Я Duddy, чем могу помочь? Вот пример функции:\nfunction test() { return 1; }';
  const { calls, rest } = extractTextToolCalls(plain, AGENT_TOOLS);

  assert.equal(calls.length, 0);
  assert.equal(rest, plain);
});

test('несколько вызовов в одном сообщении', () => {
  const content = `Сейчас прочитаю оба файла:
<tool_call>{"name": "read_file", "arguments": {"path": "src/a.js"}}</tool_call>
И второй файл:
<function name="read_file"><param name="path">src/b.js</param><param name="start_line">10</param></function>
Жду результат.`;

  const { calls, rest } = extractTextToolCalls(content, AGENT_TOOLS);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/a.js' });
  assert.equal(calls[1].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[1].function.arguments), { path: 'src/b.js', start_line: 10 });
  assert.equal(rest, 'Сейчас прочитаю оба файла:\n\nИ второй файл:\n\nЖду результат.');
});

test('runAgentTurn: восстановление текстовых вызовов инструментов для провайдера Ollama', async () => {
  const encoder = new TextEncoder();
  let callCount = 0;
  const toolStarts = [];

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/api/ps')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'test-ollama', context_length: 32768 }] })
      };
    }

    if (urlStr.includes('/chat/completions')) {
      callCount++;
      const text = callCount === 1
        ? '<tool_call>{"name": "list_dir", "arguments": {"path": "."}}</tool_call>'
        : 'Файлы просмотрены.';

      const stream = new ReadableStream({
        start(ctrl) {
          const chunk = {
            choices: [{ delta: { content: text } }]
          };
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }

    throw new Error(`Unexpected fetch to ${urlStr}`);
  };

  const session = {
    provider: 'ollama',
    apiKey: 'ollama',
    model: 'test-ollama',
    messages: []
  };

  const turn = await runAgentTurn({
    session,
    messages: [{ role: 'user', content: 'список файлов' }],
    events: {
      onToolStart: (t) => toolStarts.push(t.name)
    }
  });

  assert.equal(toolStarts.length, 1);
  assert.equal(toolStarts[0], 'list_dir');
  assert.equal(callCount, 2);
  assert.equal(turn.finalText, 'Файлы просмотрены.');
});
