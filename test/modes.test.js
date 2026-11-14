import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODES,
  MODE_INFO,
  WRITE_TOOLS,
  nextMode,
  applyMode,
  toolsForMode,
  PLAN_MODE_PROMPT
} from '../src/agent/modes.js';
import { AGENT_TOOLS } from '../src/tools/definitions.js';
import { executeTool } from '../src/tools/execute.js';
import { requestApproval } from '../src/tools/approval.js';

const originalCwd = process.cwd();
let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-modes-')));
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('nextMode циклически переключает режимы и сбрасывает неизвестные в default', () => {
  assert.strictEqual(nextMode('default'), 'acceptEdits');
  assert.strictEqual(nextMode('acceptEdits'), 'plan');
  assert.strictEqual(nextMode('plan'), 'auto');
  assert.strictEqual(nextMode('auto'), 'default');

  assert.strictEqual(nextMode('unknown'), 'default');
  assert.strictEqual(nextMode(''), 'default');
  assert.strictEqual(nextMode(null), 'default');
  assert.strictEqual(nextMode(undefined), 'default');
});

test('applyMode выставляет корректные флаги для каждого режима', () => {
  const ctxDefault = applyMode({}, 'default');
  assert.strictEqual(ctxDefault.mode, 'default');
  assert.strictEqual(ctxDefault.autoApprove, false);
  assert.strictEqual(ctxDefault.allowCommands, false);

  const ctxAcceptEdits = applyMode({}, 'acceptEdits');
  assert.strictEqual(ctxAcceptEdits.mode, 'acceptEdits');
  assert.strictEqual(ctxAcceptEdits.autoApprove, true);
  assert.strictEqual(ctxAcceptEdits.allowCommands, false);

  const ctxPlan = applyMode({}, 'plan');
  assert.strictEqual(ctxPlan.mode, 'plan');
  assert.strictEqual(ctxPlan.autoApprove, false);
  assert.strictEqual(ctxPlan.allowCommands, false);

  const ctxAuto = applyMode({}, 'auto');
  assert.strictEqual(ctxAuto.mode, 'auto');
  assert.strictEqual(ctxAuto.autoApprove, true);
  assert.strictEqual(ctxAuto.allowCommands, true);
});

test('toolsForMode фильтрует инструменты записи в режиме plan и возвращает все в default', () => {
  const planTools = toolsForMode(AGENT_TOOLS, 'plan');
  const planToolNames = planTools.map(t => t.function?.name);

  for (const writeTool of WRITE_TOOLS) {
    assert.strictEqual(planToolNames.includes(writeTool), false);
  }

  assert.ok(planToolNames.includes('read_file'));
  assert.ok(planToolNames.includes('grep'));
  assert.ok(planToolNames.includes('glob'));
  assert.ok(planToolNames.includes('list_dir'));
  assert.ok(planToolNames.includes('bash'));

  const defaultTools = toolsForMode(AGENT_TOOLS, 'default');
  assert.strictEqual(defaultTools.length, AGENT_TOOLS.length);
  assert.strictEqual(defaultTools, AGENT_TOOLS);
});

test('executeTool в режиме plan блокирует запись без запроса и разрешает чтение', async () => {
  let approveCalled = false;
  const ctx = {
    mode: 'plan',
    autoApprove: true,
    canPrompt: true,
    approve: async () => {
      approveCalled = true;
      return 'yes';
    }
  };

  const resCreate = await executeTool(
    'create_file',
    { path: 'test_plan.txt', content: 'test content' },
    ctx
  );
  assert.ok(resCreate.startsWith('Отклонено: режим планирования'));
  assert.strictEqual(approveCalled, false);
  assert.strictEqual(fsSync.existsSync('test_plan.txt'), false);

  await fs.writeFile('existing.txt', 'hello from plan test', 'utf8');
  const resRead = await executeTool('read_file', { path: 'existing.txt' }, ctx);
  assert.ok(resRead.includes('hello from plan test'));
});

test('bash в режиме plan выполняет safe-команды и отклоняет ask-команды без вызова approve', async () => {
  const ctx = {
    mode: 'plan',
    autoApprove: false,
    canPrompt: true,
    approve: async () => {
      throw new Error('approve не должен вызываться в режиме plan');
    }
  };

  const pwdRes = await executeTool('bash', { command: 'pwd' }, ctx);
  assert.strictEqual(pwdRes, tmpDir);

  const touchRes = await executeTool('bash', { command: 'touch x' }, ctx);
  assert.strictEqual(
    touchRes,
    'Отклонено: режим планирования, разрешены только безопасные команды для чтения.'
  );
  assert.strictEqual(fsSync.existsSync('x'), false);
});

test('requestApproval при ответе all для файла вызывает ctx.setMode("acceptEdits")', async () => {
  let modeSet = null;
  const ctx = {
    canPrompt: true,
    approve: async () => 'all',
    setMode: (m) => {
      modeSet = m;
    }
  };

  const res = await requestApproval('create_file', 'sample.txt', ctx, []);
  assert.strictEqual(res.approved, true);
  assert.strictEqual(modeSet, 'acceptEdits');
});

test('requestApproval при ответе all для файла без setMode выставляет autoApprove: true', async () => {
  const ctx = {
    canPrompt: true,
    approve: async () => 'all'
  };

  const res = await requestApproval('create_file', 'sample.txt', ctx, []);
  assert.strictEqual(res.approved, true);
  assert.strictEqual(ctx.autoApprove, true);
});

test('requestApproval при ответе all для команды не вызывает setMode, а добавляет команду в allowedCommands', async () => {
  let modeSet = null;
  const ctx = {
    canPrompt: true,
    approve: async () => 'all',
    setMode: (m) => {
      modeSet = m;
    }
  };

  const res = await requestApproval('bash', 'npm test', ctx, [], { commandKey: 'npm test' });
  assert.strictEqual(res.approved, true);
  assert.strictEqual(modeSet, null);
  assert.ok(ctx.allowedCommands.has('npm test'));
});

test('requestApproval замеряет время ожидания пользователя в ctx.approvalWaitMs и суммирует его', async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ctx = {
    canPrompt: true,
    approve: async () => {
      await delay(50);
      return 'yes';
    }
  };

  await requestApproval('create_file', 'a.txt', ctx, []);
  assert.ok(typeof ctx.approvalWaitMs === 'number', 'approvalWaitMs должно быть числом');
  assert.ok(ctx.approvalWaitMs >= 40, `Ожидалось >= 40 мс, получено: ${ctx.approvalWaitMs}`);

  const firstWait = ctx.approvalWaitMs;

  await requestApproval('create_file', 'b.txt', ctx, []);
  assert.ok(ctx.approvalWaitMs >= firstWait + 40, `Ожидалось >= ${firstWait + 40} мс, получено: ${ctx.approvalWaitMs}`);

  const autoCtx = {
    autoApprove: true,
    canPrompt: true,
    approvalWaitMs: 100,
    approve: async () => 'yes'
  };
  await requestApproval('create_file', 'c.txt', autoCtx, []);
  assert.strictEqual(autoCtx.approvalWaitMs, 100, 'автоподтверждение не должно увеличивать approvalWaitMs');
});
