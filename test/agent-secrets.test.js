import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn } from '../src/agent/agent.js';
import { commitTurn } from '../src/agent/history.js';

const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();
const originalState = process.env.XDG_STATE_HOME;
let tmpDir;

function toolCallStream(calls) {
  const chunks = calls
    ? [{ choices: [{ delta: { tool_calls: calls.map(([name, args], index) => ({ index, id: `call_${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] }]
    : [{ choices: [{ delta: { content: 'готово' } }] }];
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Подменяет модель сценарием шагов и возвращает тела запросов */
function scriptModel(steps) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return toolCallStream(steps.shift());
  };
  return requests;
}

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-agent-')));
  process.env.XDG_STATE_HOME = path.join(tmpDir, 'state');
  await fs.mkdir(path.join(tmpDir, 'proj'));
  process.chdir(path.join(tmpDir, 'proj'));
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  if (originalState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalState;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function newSession() {
  return { provider: 'openrouter', apiKey: 'sk-or-fake', model: 'fake/model', messages: [] };
}

test('подтверждённый секрет виден модели только в текущем ходе', async () => {
  await fs.writeFile('.env', 'TOP_SECRET=hunter2-value\n', 'utf8');
  const requests = scriptModel([[['read_file', { path: '.env' }]], null, null]);
  const session = newSession();
  const toolCtx = { canPrompt: true, approve: async () => 'yes' };

  const first = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'прочитай' }];
  const { newMessages, finalText } = await runAgentTurn({ session, messages: first, toolCtx });
  commitTurn(session, 'прочитай', newMessages, finalText);

  assert.ok(JSON.stringify(requests[1]).includes('hunter2-value'), 'модель должна увидеть файл в этом ходе');
  assert.ok(!JSON.stringify(session.messages).includes('hunter2-value'), 'секрета не должно быть в истории');

  const second = [{ role: 'system', content: 'sys' }, ...session.messages, { role: 'user', content: 'дальше' }];
  await runAgentTurn({ session, messages: second, toolCtx });
  assert.ok(!JSON.stringify(requests[2]).includes('hunter2-value'), 'следующий ход не должен отправлять секрет');
  assert.ok(JSON.stringify(requests[2]).includes('удалено из истории'));
});

test('секрет не попадает в историю и при ошибке хода', async () => {
  await fs.writeFile('.env', 'TOP_SECRET=hunter2-value\n', 'utf8');
  const session = newSession();
  let call = 0;
  globalThis.fetch = async () => {
    if (call++ === 0) return toolCallStream([['read_file', { path: '.env' }]]);
    return new Response('{"error":{"message":"boom"}}', { status: 400, headers: { 'content-type': 'application/json' } });
  };

  const messages = [{ role: 'user', content: 'прочитай' }];
  const toolCtx = { canPrompt: true, approve: async () => 'yes' };
  await assert.rejects(
    runAgentTurn({ session, messages, toolCtx }),
    (err) => {
      assert.ok(!JSON.stringify(err.partialMessages).includes('hunter2-value'));
      return true;
    }
  );
});

test('чтение из прошлого хода не разрешает перезапись, а из текущего разрешает', async () => {
  await fs.writeFile('app.txt', 'длинный файл\n', 'utf8');
  const session = newSession();
  const toolCtx = { autoApprove: true, canPrompt: false };
  const user = [{ role: 'user', content: 'x' }];

  scriptModel([[['read_file', { path: 'app.txt' }]], null]);
  await runAgentTurn({ session, messages: [...user], toolCtx });

  const blocked = scriptModel([[['create_file', { path: 'app.txt', content: 'по памяти' }]], null]);
  await runAgentTurn({ session, messages: [...user], toolCtx });
  assert.ok(JSON.stringify(blocked[1]).includes('перед перезаписью прочитай'));
  assert.strictEqual(await fs.readFile('app.txt', 'utf8'), 'длинный файл\n');

  scriptModel([[['read_file', { path: 'app.txt' }]], [['create_file', { path: 'app.txt', content: 'новое' }]], null]);
  await runAgentTurn({ session, messages: [...user], toolCtx });
  assert.strictEqual(await fs.readFile('app.txt', 'utf8'), 'новое');
});
