import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/execute.js';
import { compactToolResults, TOOL_RESULT_BUDGET, TOOL_RESULT_TARGET } from '../src/llm/compact.js';
import { commitTurn } from '../src/agent/history.js';
import { runAgentTurn } from '../src/agent/agent.js';
import { buildProjectContext } from '../src/agent/projectContext.js';
import { formatTurnUsage } from '../src/render/formatter.js';

const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();
const originalState = process.env.XDG_STATE_HOME;
let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-tokens-')));
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

const numbered = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const ctx = () => ({ autoApprove: true, canPrompt: false });

test('read_file по строкам возвращает только нужное и подсказывает продолжение', async () => {
  await fs.writeFile('a.txt', numbered(10), 'utf8');

  assert.strictEqual(
    await executeTool('read_file', { path: 'a.txt', start_line: 3, max_lines: 2 }, ctx()),
    'line 3\nline 4\n\n...[Показаны строки 3–4 из 10. Чтобы читать дальше, вызови read_file с start_line=5]...'
  );
  assert.strictEqual(await executeTool('read_file', { path: 'a.txt', start_line: 9, max_lines: 5 }, ctx()), 'line 9\nline 10');
  assert.strictEqual(await executeTool('read_file', { path: 'a.txt', start_line: '10', max_lines: '1' }, ctx()), 'line 10');
});

test('read_file: граничные случаи диапазона', async () => {
  await fs.writeFile('a.txt', 'one\n\nthree', 'utf8');
  await fs.writeFile('empty.txt', '', 'utf8');

  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 4 }, ctx()), /^Ошибка: start_line 4 за концом/);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 0 }, ctx()), /^Ошибка: start_line и max_lines/);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 1, max_lines: 0 }, ctx()), /^Ошибка: start_line и max_lines/);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 2, offset: 3 }, ctx()), /^Ошибка: укажи либо offset/);
  assert.strictEqual(await executeTool('read_file', { path: 'empty.txt', start_line: 1 }, ctx()), '');
  assert.match(await executeTool('read_file', { path: 'empty.txt', start_line: 2 }, ctx()), /^Ошибка: start_line 2/);
  assert.match(
    await executeTool('read_file', { path: 'a.txt', start_line: 1, max_lines: 2 }, ctx()),
    /^one\n\n\n\.\.\.\[Показаны строки 1–2 из 3/
  );
});

test('read_file по строкам обрезается лимитом символов и читается без потерь', async () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `${i + 1} ${'x'.repeat(30)}`);
  await fs.writeFile('wide.txt', lines.join('\n'), 'utf8');

  const toolCtx = ctx();
  const seen = [];
  let start = 1;
  for (let step = 0; step < 10; step++) {
    const res = await executeTool('read_file', { path: 'wide.txt', start_line: start, max_lines: 3000 }, toolCtx);
    const note = res.match(/\n\n\.\.\.\[Показаны строки \d+–(\d+) из 3000.*$/s);
    seen.push(note ? res.slice(0, note.index).replace(/\n$/, '') : res);
    if (!note) break;
    start = Number(note[1]) + 1;
  }
  assert.ok(seen.length > 1, 'файл длиннее лимита одного вызова');
  assert.strictEqual(seen.join('\n'), lines.join('\n'));
});

test('read_file: строка длиннее лимита дочитывается через offset', async () => {
  await fs.writeFile('min.js', `head\n${'y'.repeat(50000)}\ntail\n`, 'utf8');

  const res = await executeTool('read_file', { path: 'min.js', start_line: 2, max_lines: 1 }, ctx());
  const match = res.match(/Строка длиннее лимита\. Чтобы читать дальше, вызови read_file с offset=(\d+)/);
  assert.ok(match, res.slice(-200));
  assert.ok((await executeTool('read_file', { path: 'min.js', offset: Number(match[1]) }, ctx())).includes('tail'));
});

test('секрет в диапазоне требует подтверждения, вне диапазона нет', async () => {
  await fs.writeFile('mix.txt', `${numbered(5)}TOKEN=ghp_${'a1B2'.repeat(10)}\n`, 'utf8');

  assert.strictEqual(await executeTool('read_file', { path: 'mix.txt', start_line: 1, max_lines: 2 }, ctx()), 'line 1\nline 2\n\n...[Показаны строки 1–2 из 6. Чтобы читать дальше, вызови read_file с start_line=3]...');

  let request;
  const asking = { canPrompt: true, approve: async (r) => { request = r; return 'no'; } };
  await executeTool('read_file', { path: 'mix.txt', start_line: 5, max_lines: 2 }, asking);
  assert.ok(request.preview.some(p => p.text.includes('строка 6')), JSON.stringify(request.preview));
});

test('повторное чтение того же не отдаёт содержимое заново, после изменения файла отдаёт', async () => {
  await fs.writeFile('a.txt', numbered(3), 'utf8');
  const toolCtx = ctx();

  assert.strictEqual(await executeTool('read_file', { path: 'a.txt' }, toolCtx), numbered(3));
  assert.match(await executeTool('read_file', { path: 'a.txt' }, toolCtx), /уже прочитан в этом ходе/);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 2 }, toolCtx), /уже прочитан в этом ходе/);

  await fs.writeFile('a.txt', 'изменён\n', 'utf8');
  assert.strictEqual(await executeTool('read_file', { path: 'a.txt' }, toolCtx), 'изменён\n');
});

test('повтор диапазона большого файла не отдаёт его снова, другой диапазон отдаёт', async () => {
  await fs.writeFile('a.txt', numbered(10), 'utf8');
  const toolCtx = ctx();

  await executeTool('read_file', { path: 'a.txt', start_line: 1, max_lines: 2 }, toolCtx);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 1, max_lines: 2 }, toolCtx), /уже прочитан/);
  assert.match(await executeTool('read_file', { path: 'a.txt', start_line: 3, max_lines: 2 }, toolCtx), /^line 3/);
});

function toolMsg(id, chars, name = 'read_file') {
  return { role: 'tool', tool_call_id: id, name, content: 'x'.repeat(chars) };
}

function step(id, target) {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: target }) } }] };
}

test('compactToolResults: ниже бюджета ничего не меняет', () => {
  const messages = [step('a', 'a.js'), toolMsg('a', 1000)];
  assert.deepStrictEqual(compactToolResults(messages), []);
  assert.strictEqual(messages[1].content.length, 1000);
});

test('compactToolResults: убирает старые результаты до цели, последний шаг не трогает, объекты истории целы', () => {
  const messages = [{ role: 'system', content: 's' }];
  const originals = [];
  for (let i = 0; i < 5; i++) {
    messages.push(step(`c${i}`, `f${i}.js`));
    const msg = toolMsg(`c${i}`, 15000);
    originals.push(msg);
    messages.push(msg);
  }

  const removed = compactToolResults(messages);
  assert.deepStrictEqual(removed, ['c0', 'c1', 'c2', 'c3']);
  assert.match(messages[2].content, /Результат read_file \(f0\.js\) убран/);
  assert.strictEqual(messages[10].content.length, 15000, 'последний шаг остаётся');
  assert.strictEqual(originals[0].content.length, 15000, 'объект из истории не мутирован');

  const total = messages.filter(m => m.role === 'tool').reduce((sum, m) => sum + m.content.length, 0);
  assert.ok(total <= TOOL_RESULT_TARGET, String(total));
  assert.ok(TOOL_RESULT_TARGET < TOOL_RESULT_BUDGET);
});

test('compactToolResults: огромный последний шаг остаётся, даже если бюджет не достигнут', () => {
  const messages = [step('old', 'old.js'), toolMsg('old', 20000), step('last', 'last.js'), toolMsg('last', 70000)];
  assert.deepStrictEqual(compactToolResults(messages), ['old']);
  assert.strictEqual(messages[3].content.length, 70000);
});

test('compactToolResults: короткие результаты не трогает, чтобы не менять их на заглушку той же длины', () => {
  const messages = [step('s', 'small.js'), toolMsg('s', 400), step('b', 'b.js'), toolMsg('b', 70000), step('c', 'c.js'), toolMsg('c', 100)];
  assert.deepStrictEqual(compactToolResults(messages), ['b']);
  assert.strictEqual(messages[1].content.length, 400);
});

function sse(chunks) {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function callChunk(calls, usage) {
  return { usage, choices: [{ delta: { tool_calls: calls.map(([name, args], index) => ({ index, id: `id_${name}_${args.path}_${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] };
}

function scriptModel(steps) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const next = steps.shift();
    return sse([next ?? { choices: [{ delta: { content: 'готово' } }] }]);
  };
  return requests;
}

const session = () => ({ provider: 'openrouter', apiKey: 'k', model: 'fake/model', id: 'sess-1', messages: [] });

test('файл, убранный из контекста, снова надо прочитать перед перезаписью, а повторное чтение отдаёт его', async () => {
  const body = 'важный файл\n'.repeat(3000);
  await fs.writeFile('old.txt', body, 'utf8');
  for (const name of ['b.txt', 'c.txt', 'd.txt']) {
    await fs.writeFile(name, 'заполнитель\n'.repeat(3000), 'utf8');
  }

  const requests = scriptModel([
    callChunk([['read_file', { path: 'old.txt' }]]),
    callChunk([['read_file', { path: 'b.txt' }]]),
    callChunk([['read_file', { path: 'c.txt' }]]),
    callChunk([['read_file', { path: 'd.txt' }]]),
    callChunk([['create_file', { path: 'old.txt', content: 'по памяти' }]]),
    callChunk([['read_file', { path: 'old.txt' }]])
  ]);
  await runAgentTurn({ session: session(), messages: [{ role: 'user', content: 'x' }], toolCtx: ctx() });

  const afterBlocked = JSON.stringify(requests[5]);
  assert.ok(afterBlocked.includes('old.txt) убран из контекста'), 'результат должен быть убран');
  assert.ok(afterBlocked.includes('перед перезаписью прочитай old.txt'), 'перезапись должна быть заблокирована');
  assert.strictEqual(await fs.readFile('old.txt', 'utf8'), body);

  const reread = requests[6].messages.at(-1).content;
  assert.ok(reread.startsWith('важный файл'), 'после удаления из контекста файл читается заново');
});

test('квадратичный рост ограничен: 10 шагов чтения по 40000 символов', async () => {
  const steps = [];
  for (let i = 0; i < 10; i++) {
    const name = `f${i}.txt`;
    await fs.writeFile(name, `${i}`.repeat(40000), 'utf8');
    steps.push(callChunk([['read_file', { path: name }]]));
  }
  const requests = scriptModel(steps);
  await runAgentTurn({ session: session(), messages: [{ role: 'user', content: 'x' }], toolCtx: ctx() });

  const sizes = requests.map(r => r.messages.reduce((sum, m) => sum + String(m.content ?? '').length, 0));
  assert.ok(Math.max(...sizes) <= 2 * TOOL_RESULT_BUDGET, sizes.join(','));
  const total = sizes.reduce((a, b) => a + b, 0);
  assert.ok(total < 40000 * 55 * 0.75, `суммарный вход ${total}`);
});

test('runAgentTurn считает токены всего хода, а не последнего шага', async () => {
  await fs.writeFile('a.txt', 'a', 'utf8');
  const responses = [
    sse([callChunk([['read_file', { path: 'a.txt' }]], { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 0 } })]),
    sse([{ usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230, prompt_tokens_details: { cached_tokens: 900 } }, choices: [{ delta: { content: 'ok' } }] }])
  ];
  globalThis.fetch = async () => responses.shift();

  const { turnUsage } = await runAgentTurn({ session: session(), messages: [{ role: 'user', content: 'x' }], toolCtx: ctx() });
  assert.deepStrictEqual(turnUsage, { input: 2200, output: 80, cached: 900 });
  assert.strictEqual(formatTurnUsage(turnUsage), '↑ 2.2k ↓ 80 · кэш 900');
  assert.strictEqual(formatTurnUsage({ input: 0, output: 0, cached: 0 }), '');
});

test('кэш: Claude через OpenRouter просит его явно, остальным не мешаем, session_id только OpenRouter', async () => {
  async function payload(provider, model) {
    const requests = scriptModel([null]);
    const s = { ...session(), provider, model };
    await runAgentTurn({ session: s, messages: [{ role: 'user', content: 'x' }], toolCtx: ctx() });
    return requests[0];
  }

  const claude = await payload('openrouter', 'anthropic/claude-sonnet-5.5');
  assert.deepStrictEqual(claude.cache_control, { type: 'ephemeral' });
  assert.strictEqual(claude.session_id, 'sess-1');

  const openai = await payload('openrouter', 'openai/gpt-5.5');
  assert.strictEqual(openai.cache_control, undefined);
  assert.strictEqual(openai.session_id, 'sess-1');

  const ollama = await payload('ollama', 'llama3');
  assert.strictEqual(ollama.cache_control, undefined);
  assert.strictEqual(ollama.session_id, undefined);
});

test('история: большие аргументы записи убираются, подпись Gemini и мелкие вызовы не трогаются', () => {
  const big = 'b'.repeat(5000);
  const call = (id, name, args, extra) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) }, ...extra });
  const session = {
    messages: [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          call('1', 'create_file', { path: 'a.js', content: big }),
          call('2', 'edit_file', { path: 'b.js', old_content: 'x', new_content: 'y' }),
          call('3', 'create_file', { path: 'c.js', content: big }, { extra_content: { google: { thought_signature: 'sig' } } })
        ]
      },
      { role: 'tool', tool_call_id: '1', name: 'create_file', content: 'ok' },
      { role: 'assistant', content: 'готово' }
    ]
  };

  commitTurn(session, 'дальше', [{ role: 'assistant', content: 'ок' }], 'ок');
  const [first, second, third] = session.messages[1].tool_calls;
  assert.deepStrictEqual(JSON.parse(first.function.arguments), { path: 'a.js', content: '[5000 символов убрано из истории]' });
  assert.deepStrictEqual(JSON.parse(second.function.arguments), { path: 'b.js', old_content: 'x', new_content: 'y' });
  assert.strictEqual(JSON.parse(third.function.arguments).content, big);
});

test('карта проекта: список файлов, инструкции, .gitignore уважается', async () => {
  await fs.mkdir('src');
  await fs.mkdir('node_modules');
  await fs.writeFile('.gitignore', 'node_modules\n', 'utf8');
  await fs.writeFile('src/app.js', 'x', 'utf8');
  await fs.writeFile('node_modules/dep.js', 'x', 'utf8');
  await fs.writeFile('AGENTS.md', 'Тесты: npm test', 'utf8');

  const text = await buildProjectContext(process.cwd());
  assert.ok(text.includes('src/app.js'));
  assert.ok(!text.includes('dep.js'));
  assert.ok(text.includes('<project_notes>\nТесты: npm test\n</project_notes>'));
  assert.ok(text.includes(`Working directory: ${process.cwd()}`));
});

test('карта проекта: инструкции обрезаются, файл с секретом и симлинк наружу в промпт не попадают', async () => {
  await fs.writeFile('AGENTS.md', 'я'.repeat(9000), 'utf8');
  assert.ok((await buildProjectContext(process.cwd())).includes('Обрезано, полный файл: AGENTS.md'));

  await fs.writeFile('AGENTS.md', `TOKEN=ghp_${'a1B2'.repeat(10)}`, 'utf8');
  assert.ok(!(await buildProjectContext(process.cwd())).includes('ghp_'));

  await fs.rm('AGENTS.md');
  await fs.writeFile(path.join(tmpDir, 'outside.md'), 'чужой текст', 'utf8');
  await fs.symlink(path.join(tmpDir, 'outside.md'), 'AGENTS.md');
  assert.ok(!(await buildProjectContext(process.cwd())).includes('чужой текст'));
});

test('карта проекта: большой проект сворачивается по папкам, размер ограничен', async () => {
  for (const dir of ['a', 'b']) {
    await fs.mkdir(dir);
    for (let i = 0; i < 100; i++) {
      await fs.writeFile(path.join(dir, `f${i}.js`), 'x', 'utf8');
    }
  }
  const text = await buildProjectContext(process.cwd());
  assert.ok(text.includes('a/ (100)'), text);
  assert.ok(!text.includes('f5.js'));
  assert.ok(text.length < 1000);
});

test('карта проекта работает и без файлов', async () => {
  const text = await buildProjectContext(process.cwd());
  assert.ok(text.includes('PROJECT CONTEXT'));
  assert.ok(!text.includes('Files ('));
});

test('buildProjectContext(dir, { lean: true }) ограничивает пути до 20 и обрезает AGENTS.md до 1000 символов', async () => {
  const leanDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-lean-test-')));
  try {
    for (let i = 0; i < 50; i++) {
      const sub = path.join(leanDir, `dir_${i % 5}`);
      await fs.mkdir(sub, { recursive: true });
      await fs.writeFile(path.join(sub, `file_${i}.txt`), 'content', 'utf8');
    }
    const longNotes = 'a'.repeat(3500);
    await fs.writeFile(path.join(leanDir, 'AGENTS.md'), longNotes, 'utf8');

    const fullCtx = await buildProjectContext(leanDir, { lean: false });
    assert.ok(fullCtx.includes(longNotes), 'В полном режиме 3500 символов не обрезаются');

    const leanCtx = await buildProjectContext(leanDir, { lean: true });
    assert.ok(leanCtx.includes('Large project, files per folder:'));
    const filesSection = leanCtx.split('Files (respecting .gitignore):\n')[1]?.split('\n\n')[0] || '';
    const fileLines = filesSection.split('\n').filter(Boolean);
    assert.ok(fileLines.length <= 21, `Строк в секции файлов: ${fileLines.length}`);

    assert.ok(leanCtx.includes('...[Обрезано, полный файл: AGENTS.md]...'));
    const notesMatch = leanCtx.match(/<project_notes>\n([\s\S]*?)\n\.\.\.\[Обрезано/);
    assert.ok(notesMatch, 'Секция project_notes должна содержать обрезку');
    assert.equal(notesMatch[1].length, 1000, 'Длина обрезанных инструкций должна быть ровно 1000 символов');
  } finally {
    await fs.rm(leanDir, { recursive: true, force: true });
  }
});
