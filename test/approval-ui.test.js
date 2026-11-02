import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import React, { useEffect, useRef, useState } from 'react';
import { render } from 'ink';
import { Overlay } from '../src/ui/Overlay.js';
import { useToolContext } from '../src/ui/hooks/useToolContext.js';
import { requestApproval } from '../src/tools/approval.js';

const h = React.createElement;
const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

/** Настоящая цепочка TUI: useToolContext -> setOverlay -> Overlay -> Approval */
function Harness({ onReady }) {
  const [overlay, setOverlay] = useState(null);
  const liveToolsRef = useRef([]);
  const lastActivityRef = useRef(0);
  const { toolCtxRef } = useToolContext({
    session: {},
    liveToolsRef,
    setLiveTools: () => {},
    setOverlay,
    lastActivityRef
  });
  useEffect(() => onReady(toolCtxRef.current), []);
  return h(Overlay, { overlay });
}

async function mountDialog() {
  const stdout = new EventEmitter();
  stdout.columns = 100;
  stdout.rows = 40;
  let frame = '';
  stdout.write = (chunk) => {
    frame = String(chunk);
    return true;
  };

  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;

  let toolCtx;
  const app = render(h(Harness, { onReady: (ctx) => { toolCtx = ctx; } }), {
    stdout,
    stdin,
    stderr: stdout,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false
  });
  await tick();

  return { toolCtx, stdin, frame: () => frame, unmount: () => app.unmount() };
}

test('TUI: диалог секрета не предлагает «на всю сессию», a игнорируется, Enter означает отказ', async () => {
  const ui = await mountDialog();
  const pending = requestApproval('read_file', '.env', ui.toolCtx, [], { sensitive: true });
  await tick();

  assert.ok(ui.frame().includes('Разрешить read_file: .env?'), ui.frame());
  assert.ok(!ui.frame().includes('не спрашивать'), ui.frame());

  ui.stdin.write('a');
  await tick();
  assert.ok(ui.frame().includes('Разрешить read_file: .env?'), 'a не должна закрывать диалог');
  assert.strictEqual(ui.toolCtx.autoApprove, false);

  ui.stdin.write('\r');
  const result = await pending;
  assert.strictEqual(result.approved, false);
  assert.strictEqual(ui.toolCtx.autoApprove, false);
  ui.unmount();
});

test('TUI: обычный диалог сохраняет «на всю сессию», но autoApprove не отменяет вопрос о секрете', async () => {
  const ui = await mountDialog();
  const pending = requestApproval('edit_file', 'app.js', ui.toolCtx, []);
  await tick();

  assert.ok(ui.frame().includes('не спрашивать'), ui.frame());
  ui.stdin.write('a');
  assert.strictEqual((await pending).approved, true);
  assert.strictEqual(ui.toolCtx.autoApprove, true);

  const secret = requestApproval('read_file', '.env', ui.toolCtx, [], { sensitive: true });
  await tick();
  assert.ok(ui.frame().includes('Разрешить read_file: .env?'), ui.frame());
  ui.stdin.write('y');
  assert.strictEqual((await secret).approved, true);
  ui.unmount();
});

test('TUI: вставка текста y не подтверждает действие', async () => {
  const ui = await mountDialog();
  let settled = false;
  const pending = requestApproval('bash', 'touch x', ui.toolCtx, [], { commandKey: 'touch x' })
    .then((result) => {
      settled = true;
      return result;
    });
  await tick();

  ui.stdin.write('\x1b[200~y\x1b[201~');
  await tick();
  assert.strictEqual(settled, false, 'вставка не должна закрывать диалог');

  ui.stdin.write('n');
  assert.strictEqual((await pending).approved, false);
  ui.unmount();
});
