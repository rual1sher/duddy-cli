import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render, usePaste } from 'ink';
import { Overlay } from '../src/ui/Overlay.js';
import { InputBox } from '../src/ui/InputBox.js';

const h = React.createElement;
const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

async function mountSecret({ overlay, extra = null } = {}) {
  const stdout = new EventEmitter();
  stdout.isTTY = true;
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

  const app = render(
    h(
      React.Fragment,
      null,
      h(Overlay, { overlay }),
      extra
    ),
    {
      stdout,
      stdin,
      stderr: stdout,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false
    }
  );
  await tick();

  return {
    stdin,
    frame: () => frame,
    unmount: () => app.unmount()
  };
}

test('1. вставка и Enter: onSubmit получает ключ целиком', async () => {
  let submitted = null;
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: (val) => { submitted = val; },
      onCancel: () => {}
    }
  });

  ui.stdin.write('\x1b[200~sk-test-secret-key-12345\x1b[201~');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(submitted, 'sk-test-secret-key-12345');
  ui.unmount();
});

test('2. вставка с пробелами и переводами строк: они удалены', async () => {
  let submitted = null;
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: (val) => { submitted = val; },
      onCancel: () => {}
    }
  });

  ui.stdin.write('\x1b[200~  sk-test-\r\n12345 \t \x00\x1f\x7f  \x1b[201~');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(submitted, 'sk-test-12345');
  ui.unmount();
});

test('3. вставка, затем печать символа: символ попадает в конец', async () => {
  let submitted = null;
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: (val) => { submitted = val; },
      onCancel: () => {}
    }
  });

  ui.stdin.write('\x1b[200~sk-part-\x1b[201~');
  await tick();
  ui.stdin.write('x');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(submitted, 'sk-part-x');
  ui.unmount();
});

test('4. набор с клавиатуры без вставки по-прежнему работает', async () => {
  let submitted = null;
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: (val) => { submitted = val; },
      onCancel: () => {}
    }
  });

  ui.stdin.write('m');
  await tick();
  ui.stdin.write('y');
  await tick();
  ui.stdin.write('k');
  await tick();
  ui.stdin.write('e');
  await tick();
  ui.stdin.write('y');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(submitted, 'mykey');
  ui.unmount();
});

test('5. в кадре нет ключа открытым текстом, есть маска', async () => {
  const secret = 'super-secret-123';
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: () => {},
      onCancel: () => {}
    }
  });

  ui.stdin.write(`\x1b[200~${secret}\x1b[201~`);
  await tick();

  const currentFrame = ui.frame();
  assert.ok(!currentFrame.includes(secret), `В кадре не должно быть открытого ключа: ${currentFrame}`);
  assert.ok(currentFrame.includes('•'), `В кадре должна быть маска: ${currentFrame}`);
  const maskCount = (currentFrame.match(/•/g) || []).length;
  assert.strictEqual(maskCount, secret.length);
  ui.unmount();
});

test('6. Esc вызывает onCancel', async () => {
  let cancelled = false;
  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: () => {},
      onCancel: () => { cancelled = true; }
    }
  });

  ui.stdin.write('\x1b');
  await tick();

  assert.strictEqual(cancelled, true);
  ui.unmount();
});

test('7. InputBox / неактивный обработчик usePaste не получает вставку, а Overlay получает', async () => {
  let inactiveCalled = false;
  let submitted = null;

  function InactivePasteWatcher() {
    usePaste(() => {
      inactiveCalled = true;
    }, { isActive: false });
    return null;
  }

  const ui = await mountSecret({
    overlay: {
      kind: 'secret',
      title: 'Ключ',
      onSubmit: (val) => { submitted = val; },
      onCancel: () => {}
    },
    extra: h(InactivePasteWatcher)
  });

  ui.stdin.write('\x1b[200~paste-target-secret\x1b[201~');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(inactiveCalled, false, 'Неактивный usePaste не должен вызываться');
  assert.strictEqual(submitted, 'paste-target-secret', 'Overlay должен получить вставку');
  ui.unmount();
});

test('главное поле ввода рядом с окном ключа не перехватывает вставку', async () => {
  let submitted = null;
  const ui = await mountSecret({
    overlay: { kind: 'secret', title: 'Ключ', onSubmit: (val) => { submitted = val; }, onCancel: () => {} },
    extra: h(InputBox, { overlayOpen: true, onSend: () => {} })
  });

  ui.stdin.write('\x1b[200~sk-or-v1-paste\x1b[201~');
  await tick();
  assert.ok(!ui.frame().includes('sk-or-v1-paste'), 'ключ не должен попасть в главное поле открытым текстом');

  ui.stdin.write('\r');
  await tick();
  assert.strictEqual(submitted, 'sk-or-v1-paste');
  ui.unmount();
});

test('вставка доходит до поиска в выборе модели, пока главное поле ввода рядом', async () => {
  let selected = null;
  const ui = await mountSecret({
    overlay: {
      kind: 'picker',
      title: 'Модели',
      searchable: true,
      items: [{ label: 'alpha', value: 'a' }, { label: 'beta', value: 'b' }],
      onSelect: (val) => { selected = val; },
      onCancel: () => {}
    },
    extra: h(InputBox, { overlayOpen: true, onSend: () => {} })
  });

  ui.stdin.write('\x1b[200~beta\x1b[201~');
  await tick();
  ui.stdin.write('\r');
  await tick();

  assert.strictEqual(selected, 'b');
  ui.unmount();
});

