import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/execute.js';

const originalCwd = process.cwd();
let testTmpDir;
let outsideDir;

before(async () => {
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-outside-'));
  await fs.writeFile(path.join(outsideDir, 'outside-read.txt'), 'secret outside', 'utf8');
});

after(async () => {
  process.chdir(originalCwd);
  if (outsideDir) {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-tools-test-'));
  const realTmpDir = await fs.realpath(testTmpDir);
  process.chdir(realTmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (testTmpDir) {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  }
});

test('create_file создаёт файл и вложенные папки, повторный вызов пишет «перезаписан»', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const res1 = await executeTool('create_file', { path: 'nested/dir/hello.txt', content: 'hello world' }, toolCtx);
  assert.strictEqual(res1, '✓ Файл nested/dir/hello.txt создан (11 байт).');
  const readBack1 = await fs.readFile('nested/dir/hello.txt', 'utf8');
  assert.strictEqual(readBack1, 'hello world');

  const res2 = await executeTool('create_file', { path: 'nested/dir/hello.txt', content: 'hello new world' }, toolCtx);
  assert.strictEqual(res2, '✓ Файл nested/dir/hello.txt перезаписан (15 байт).');
  const readBack2 = await fs.readFile('nested/dir/hello.txt', 'utf8');
  assert.strictEqual(readBack2, 'hello new world');
});

test('create_file без autoApprove и canPrompt:false возвращает строку на «Отклонено» и файл не создаёт', async () => {
  const toolCtx = { autoApprove: false, canPrompt: false };
  const res = await executeTool('create_file', { path: 'denied.txt', content: 'secret' }, toolCtx);
  assert.ok(res.startsWith('Отклонено: действие "create_file" требует подтверждения'));
  assert.strictEqual(fsSync.existsSync('denied.txt'), false);
});

test('create_file в ../x и в абсолютный путь вне папки возвращают ошибку и ничего не пишут', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const root = await fs.realpath(process.cwd());

  const resRel = await executeTool('create_file', { path: '../escaped.txt', content: 'escaped' }, toolCtx);
  assert.strictEqual(
    resRel,
    `Ошибка: Доступ запрещён — путь "../escaped.txt" находится за пределами рабочей папки ${root}.`
  );
  assert.strictEqual(fsSync.existsSync(path.resolve('..', 'escaped.txt')), false);

  const outsideAbs = path.join(outsideDir, 'abs-escape.txt');
  const resAbs = await executeTool('create_file', { path: outsideAbs, content: 'escaped' }, toolCtx);
  assert.strictEqual(
    resAbs,
    `Ошибка: Доступ запрещён — путь "${outsideAbs}" находится за пределами рабочей папки ${root}.`
  );
  assert.strictEqual(fsSync.existsSync(outsideAbs), false);
});

test('симлинк внутри папки, ведущий наружу: read_file и create_file через него не выходят за папку', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const root = await fs.realpath(process.cwd());
  await fs.symlink(outsideDir, 'link_outside');

  const resRead = await executeTool('read_file', { path: 'link_outside/outside-read.txt' }, toolCtx);
  assert.strictEqual(
    resRead,
    `Ошибка: Доступ запрещён — путь "link_outside/outside-read.txt" находится за пределами рабочей папки ${root}.`
  );

  const resCreate = await executeTool('create_file', { path: 'link_outside/new_file.txt', content: 'hack' }, toolCtx);
  assert.strictEqual(
    resCreate,
    `Ошибка: Доступ запрещён — путь "link_outside/new_file.txt" находится за пределами рабочей папки ${root}.`
  );
  assert.strictEqual(fsSync.existsSync(path.join(outsideDir, 'new_file.txt')), false);
});

test('read_file обрезает файл длиннее 40000 символов и подсказывает offset', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const longContent = 'A'.repeat(40050);
  await fs.writeFile('huge.txt', longContent, 'utf8');

  const res = await executeTool('read_file', { path: 'huge.txt' }, toolCtx);
  assert.strictEqual(
    res,
    'A'.repeat(40000) + '\n\n...[Обрезано: показаны символы 0–40000 из 40050. Чтобы читать дальше, вызови read_file с offset=40000]...'
  );

  const tail = await executeTool('read_file', { path: 'huge.txt', offset: 40000 }, toolCtx);
  assert.strictEqual(tail, 'A'.repeat(50));
});

test('read_file по offset восстанавливает большой файл байт в байт', async () => {
  const toolCtx = { autoApprove: false, canPrompt: false };
  const lines = [];
  for (let i = 0; i < 12000; i++) lines.push(`строка ${i} 😀`);
  lines.push('😀'.repeat(30000), 'ХВОСТ');
  const original = lines.join('\n');
  await fs.writeFile('rows.txt', original, 'utf8');

  let assembled = '';
  let offset = 0;
  for (let step = 0; step < 100; step++) {
    const res = await executeTool('read_file', { path: 'rows.txt', offset }, toolCtx);
    const match = res.match(/\n\n\.\.\.\[Обрезано: показаны символы \d+–(\d+) из \d+\..*$/s);
    assembled += match ? res.slice(0, match.index) : res;
    if (!match) break;
    offset = Number(match[1]);
  }
  assert.strictEqual(assembled, original);
});

test('read_file принимает offset строкой и отклоняет некорректный', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('short.txt', 'abcdef', 'utf8');

  assert.strictEqual(await executeTool('read_file', { path: 'short.txt', offset: '2' }, toolCtx), 'cdef');
  assert.match(await executeTool('read_file', { path: 'short.txt', offset: -1 }, toolCtx), /^Ошибка: offset должен быть/);
  assert.match(await executeTool('read_file', { path: 'short.txt', offset: 6 }, toolCtx), /^Ошибка: offset 6 за концом файла/);
});

test('read_file не читает бинарный файл и предупреждает о кодировке не UTF-8', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('image.bin', Buffer.from([0x89, 0x50, 0x00, 0x47]));
  await fs.writeFile('cp1251.txt', Buffer.from([0x50, 0xcf, 0xf0, 0xe8]));

  assert.match(await executeTool('read_file', { path: 'image.bin' }, toolCtx), /^Ошибка: image\.bin — бинарный файл/);
  assert.match(await executeTool('read_file', { path: 'cp1251.txt' }, toolCtx), /файл не в UTF-8/);
});

test('create_file не перезаписывает файл, который модель не могла прочитать целиком', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const big = 'Я'.repeat(40001);
  await fs.writeFile('big.txt', big, 'utf8');
  const binary = Buffer.from([0xff, 0x00, 0xfe]);
  await fs.writeFile('data.bin', binary);

  assert.match(await executeTool('create_file', { path: 'big.txt', content: 'x' }, toolCtx), /^Ошибка: big\.txt длиннее 40000 символов/);
  assert.strictEqual(await fs.readFile('big.txt', 'utf8'), big);

  assert.match(await executeTool('create_file', { path: 'data.bin', content: 'x' }, toolCtx), /^Ошибка: data\.bin не текст в UTF-8/);
  assert.deepStrictEqual(await fs.readFile('data.bin'), binary);
});

test('create_file показывает в подтверждении, что именно будет потеряно', async () => {
  await fs.writeFile('app.js', 'one\ntwo\nthree\n', 'utf8');
  let request;
  const toolCtx = { canPrompt: true, approve: async (r) => { request = r; return 'no'; } };

  await executeTool('read_file', { path: 'app.js' }, toolCtx);
  await executeTool('create_file', { path: 'app.js', content: 'one\nTWO\n' }, toolCtx);
  assert.strictEqual(request.sensitive, false);
  assert.deepStrictEqual(request.preview, [
    { kind: 'warn', text: 'Файл: app.js (ПЕРЕЗАПИСЬ существующего файла: было 4 строк, станет 3)' },
    { kind: 'del', text: 'two' },
    { kind: 'del', text: 'three' },
    { kind: 'add', text: 'TWO' }
  ]);
  assert.strictEqual(await fs.readFile('app.js', 'utf8'), 'one\ntwo\nthree\n');

  await executeTool('create_file', { path: 'new.txt', content: 'hello\nworld' }, toolCtx);
  assert.deepStrictEqual(request.preview.slice(1), [
    { kind: 'add', text: 'hello' },
    { kind: 'add', text: 'world' }
  ]);
});

test('edit_file не портит файл в другой кодировке', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const cp1251 = Buffer.from([0x61, 0x62, 0x63, 0xcf, 0xf0, 0xe8]);
  await fs.writeFile('win.txt', cp1251);

  const res = await executeTool('edit_file', { path: 'win.txt', old_content: 'abc', new_content: 'xyz' }, toolCtx);
  assert.match(res, /^Ошибка: win\.txt не в UTF-8/);
  assert.deepStrictEqual(await fs.readFile('win.txt'), cp1251);
});

test('create_file и edit_file не затирают файл, изменённый во время подтверждения', async () => {
  await fs.writeFile('race.txt', 'alpha\n', 'utf8');
  const toolCtx = {
    canPrompt: true,
    approve: async () => {
      await fs.writeFile('race.txt', 'правка пользователя\n', 'utf8');
      return 'yes';
    }
  };

  const edited = await executeTool('edit_file', { path: 'race.txt', old_content: 'alpha', new_content: 'beta' }, toolCtx);
  assert.match(edited, /^Ошибка: race\.txt изменился/);
  assert.strictEqual(await fs.readFile('race.txt', 'utf8'), 'правка пользователя\n');

  await fs.writeFile('race.txt', 'alpha\n', 'utf8');
  await executeTool('read_file', { path: 'race.txt' }, toolCtx);
  const created = await executeTool('create_file', { path: 'race.txt', content: 'beta' }, toolCtx);
  assert.match(created, /^Ошибка: race\.txt изменился/);
  assert.strictEqual(await fs.readFile('race.txt', 'utf8'), 'правка пользователя\n');

  const appearing = {
    canPrompt: true,
    approve: async () => {
      await fs.writeFile('appeared.txt', 'чужой файл', 'utf8');
      return 'yes';
    }
  };
  const res = await executeTool('create_file', { path: 'appeared.txt', content: 'beta' }, appearing);
  assert.match(res, /^Ошибка: appeared\.txt изменился/);
  assert.strictEqual(await fs.readFile('appeared.txt', 'utf8'), 'чужой файл');
});

test('секреты: без интерактива не читаются даже с autoApprove', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const secrets = ['.env', '.env.production', 'prod.env', 'server.pem', 'deploy.KEY', 'id_ed25519', '.npmrc', 'credentials.json'];
  await fs.mkdir('.ssh');
  await fs.mkdir('nested');
  secrets.push('.ssh/config', 'nested/../.env');

  for (const name of secrets) {
    await fs.writeFile(name, 'TOP_SECRET', 'utf8');
    const res = await executeTool('read_file', { path: name }, toolCtx);
    assert.match(res, /^Отклонено: /, name);
    assert.ok(!res.includes('TOP_SECRET'), name);
  }
});

test('секреты: шаблоны и обычные файлы читаются без вопросов', async () => {
  const toolCtx = { autoApprove: false, canPrompt: false };
  const safe = ['.env.example', '.env.local.sample', 'env.js', 'id_ed25519.pub', 'keyboard.js', 'key.txt', '.envelope'];
  for (const name of safe) {
    await fs.writeFile(name, 'public', 'utf8');
    assert.strictEqual(await executeTool('read_file', { path: name }, toolCtx), 'public', name);
  }
  await fs.mkdir('.env');
  await fs.writeFile('.env/site.py', 'venv', 'utf8');
  assert.strictEqual(await executeTool('read_file', { path: '.env/site.py' }, toolCtx), 'venv');
});

test('секреты: симлинк на секрет не обходит проверку', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('.env', 'TOP_SECRET', 'utf8');
  await fs.symlink('.env', 'notes.txt');
  await fs.mkdir('.aws');
  await fs.writeFile('.aws/data.txt', 'TOP_SECRET', 'utf8');
  await fs.symlink('.aws', 'cloud');

  assert.match(await executeTool('read_file', { path: 'notes.txt' }, toolCtx), /^Отклонено: /);
  assert.match(await executeTool('read_file', { path: 'cloud/data.txt' }, toolCtx), /^Отклонено: /);
});

test('секреты: нужно отдельное «да» на каждое обращение, «на всю сессию» не срабатывает', async () => {
  await fs.writeFile('.env', 'TOP_SECRET', 'utf8');
  const answers = ['yes', 'all', 'no'];
  const requests = [];
  const toolCtx = {
    autoApprove: true,
    canPrompt: true,
    approve: async (r) => {
      requests.push(r);
      return answers.shift();
    }
  };

  assert.strictEqual(await executeTool('read_file', { path: '.env' }, toolCtx), 'TOP_SECRET');
  assert.match(await executeTool('read_file', { path: '.env' }, toolCtx), /^Отклонено пользователем/);
  assert.match(await executeTool('read_file', { path: '.env' }, toolCtx), /^Отклонено пользователем/);
  assert.strictEqual(requests.length, 3);
  assert.ok(requests.every(r => r.sensitive));

  const plainCtx = { autoApprove: false, canPrompt: true, approve: async () => 'all' };
  await executeTool('read_file', { path: '.env' }, plainCtx);
  assert.strictEqual(plainCtx.autoApprove, false);
});

test('секреты: запись и удаление при --yes тоже требуют подтверждения', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('.env', 'A=1\n', 'utf8');

  assert.match(await executeTool('create_file', { path: '.env.local', content: 'x' }, toolCtx), /^Отклонено: /);
  assert.strictEqual(fsSync.existsSync('.env.local'), false);
  assert.match(await executeTool('edit_file', { path: '.env', old_content: 'A=1', new_content: 'A=2' }, toolCtx), /^Отклонено: /);
  assert.match(await executeTool('delete_file', { path: '.env' }, toolCtx), /^Отклонено: /);
  assert.strictEqual(await fs.readFile('.env', 'utf8'), 'A=1\n');

  await fs.mkdir('.ssh');
  assert.match(await executeTool('create_file', { path: '.ssh/authorized_keys', content: 'x' }, toolCtx), /^Отклонено: /);
  assert.match(await executeTool('delete_folder', { path: '.ssh' }, toolCtx), /^Отклонено: /);
  assert.ok(fsSync.existsSync('.ssh'));
});

test('настройки duddy с ключами недоступны даже с подтверждением', async () => {
  const dir = path.join('.config', 'duddy');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'config.json'), '{"apiKey":"sk-or-secret"}', 'utf8');
  await fs.symlink(dir, 'settings');
  const toolCtx = { autoApprove: true, canPrompt: true, approve: async () => 'yes' };

  for (const target of ['.config/duddy/config.json', 'settings/config.json', 'settings']) {
    const res = await executeTool(target === 'settings' ? 'list_dir' : 'read_file', { path: target }, toolCtx);
    assert.match(res, /^Ошибка: Доступ запрещён/, target);
    assert.ok(!res.includes('sk-or-secret'), target);
  }
});

test('edit_file: точная замена', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('exact.txt', 'const a = 1;\nconst b = 2;\n', 'utf8');

  const res = await executeTool('edit_file', {
    path: 'exact.txt',
    old_content: 'const b = 2;',
    new_content: 'const b = 42;'
  }, toolCtx);

  assert.strictEqual(res, '✓ Файл exact.txt успешно изменен.');
  const content = await fs.readFile('exact.txt', 'utf8');
  assert.strictEqual(content, 'const a = 1;\nconst b = 42;\n');
});

test('edit_file: замена с другими отступами (fuzzyReplace)', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const initial = 'function test() {\n    const x = 1;\n    return x;\n}';
  await fs.writeFile('fuzzy.txt', initial, 'utf8');

  const res = await executeTool('edit_file', {
    path: 'fuzzy.txt',
    old_content: 'function test() {\n  const x = 1;\n  return x;\n}',
    new_content: 'function test() {\n  const x = 99;\n  return x;\n}'
  }, toolCtx);

  assert.strictEqual(res, '✓ Файл fuzzy.txt успешно изменен.');
  const content = await fs.readFile('fuzzy.txt', 'utf8');
  assert.strictEqual(content, 'function test() {\n  const x = 99;\n  return x;\n}');
});

test('edit_file: old_content не найден', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('missing.txt', 'alpha\nbeta\n', 'utf8');

  const res = await executeTool('edit_file', {
    path: 'missing.txt',
    old_content: 'gamma',
    new_content: 'delta'
  }, toolCtx);

  const expected = `Ошибка: Указанный old_content не найден в файле missing.txt.
Подсказки для исправления:
1. Если вы хотите полностью перезаписать файл новым содержимым — вызовите инструмент create_file(path: "missing.txt", content: "...").
2. Для частичной замены сначала вызовите read_file, скопируйте точный непрерывный фрагмент строк из файла (включая отступы).`;
  assert.strictEqual(res, expected);
});

test('edit_file: фрагмент встречается дважды — текст ошибки с числом', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('dup.txt', 'item\nitem\n', 'utf8');

  const res = await executeTool('edit_file', {
    path: 'dup.txt',
    old_content: 'item',
    new_content: 'unique'
  }, toolCtx);

  assert.strictEqual(
    res,
    'Ошибка: фрагмент old_content встречается в dup.txt 2 раз(а). Добавь в old_content больше соседних строк, чтобы совпадение было единственным.'
  );
});

test('delete_file на папке — ошибка; delete_folder на . — ошибка; delete_folder на симлинке — ошибка', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };

  await fs.mkdir('subfolder');
  const resDelFileOnDir = await executeTool('delete_file', { path: 'subfolder' }, toolCtx);
  assert.strictEqual(
    resDelFileOnDir,
    'Ошибка: Путь "subfolder" является папкой. Для удаления папок используйте delete_folder.'
  );

  const resDelFolderRoot = await executeTool('delete_folder', { path: '.' }, toolCtx);
  assert.strictEqual(resDelFolderRoot, 'Ошибка: Нельзя удалить корневую рабочую папку.');

  await fs.symlink('subfolder', 'symlink-subfolder');
  const resDelFolderSymlink = await executeTool('delete_folder', { path: 'symlink-subfolder' }, toolCtx);
  assert.strictEqual(
    resDelFolderSymlink,
    'Ошибка: Путь "symlink-subfolder" является символической ссылкой, удалите её через delete_file.'
  );
});

test('list_dir: формат строки с числом элементов', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.mkdir('dir_alpha');
  await fs.writeFile('file_beta.txt', 'beta', 'utf8');

  const res = await executeTool('list_dir', { path: '.' }, toolCtx);
  assert.ok(res.startsWith('Содержимое папки . (2 элементов):\n'));
  assert.ok(res.includes('📁 dir_alpha'));
  assert.ok(res.includes('📄 file_beta.txt'));
});

test('неизвестный инструмент — Ошибка: Неизвестный инструмент X', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const res1 = await executeTool('some_unknown_tool', {}, toolCtx);
  assert.strictEqual(res1, 'Ошибка: Неизвестный инструмент some_unknown_tool');

  const res2 = await executeTool('constructor', {}, toolCtx);
  assert.strictEqual(res2, 'Ошибка: Неизвестный инструмент constructor');
});

test('create_file не перезаписывает файл, который модель не прочитала целиком в этом ходе', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await fs.writeFile('notes.txt', 'важное\nсодержимое\n', 'utf8');

  const blind = await executeTool('create_file', { path: 'notes.txt', content: 'x' }, toolCtx);
  assert.match(blind, /^Ошибка: перед перезаписью прочитай notes\.txt/);
  assert.strictEqual(await fs.readFile('notes.txt', 'utf8'), 'важное\nсодержимое\n');

  await executeTool('read_file', { path: 'notes.txt' }, toolCtx);
  await fs.writeFile('notes.txt', 'правка пользователя\n', 'utf8');
  const stale = await executeTool('create_file', { path: 'notes.txt', content: 'x' }, toolCtx);
  assert.match(stale, /^Ошибка: перед перезаписью прочитай/);
  assert.strictEqual(await fs.readFile('notes.txt', 'utf8'), 'правка пользователя\n');

  await executeTool('read_file', { path: 'notes.txt' }, toolCtx);
  const res = await executeTool('create_file', { path: 'notes.txt', content: 'новое' }, toolCtx);
  assert.match(res, /^✓ Файл notes\.txt перезаписан/);
});

test('create_file: своя запись и своя правка считаются прочитанными, чужой хвост — нет', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  await executeTool('create_file', { path: 'own.txt', content: 'one\n' }, toolCtx);
  await executeTool('edit_file', { path: 'own.txt', old_content: 'one', new_content: 'two' }, toolCtx);
  assert.match(await executeTool('create_file', { path: 'own.txt', content: 'three' }, toolCtx), /^✓/);

  await fs.writeFile('empty.txt', '', 'utf8');
  assert.match(await executeTool('create_file', { path: 'empty.txt', content: 'x' }, toolCtx), /^✓/);

  await fs.writeFile('part.txt', 'abcdef', 'utf8');
  await executeTool('read_file', { path: 'part.txt', offset: 3 }, toolCtx);
  assert.match(await executeTool('create_file', { path: 'part.txt', content: 'x' }, toolCtx), /^Ошибка: перед перезаписью/);
});

test('секреты в содержимом: файл с обычным именем требует подтверждения, значение не показывается', async () => {
  const key = 'ghp_' + 'a1B2'.repeat(10);
  await fs.writeFile('backup.txt', `первая строка\nвторая\nTOKEN=${key}\n`, 'utf8');
  let request;
  const toolCtx = { autoApprove: true, canPrompt: true, approve: async (r) => { request = r; return 'no'; } };

  const res = await executeTool('read_file', { path: 'backup.txt' }, toolCtx);
  assert.match(res, /^Отклонено пользователем/);
  assert.strictEqual(request.sensitive, true);
  const shown = JSON.stringify(request.preview);
  assert.ok(shown.includes('токен GitHub, строка 3'), shown);
  assert.ok(!shown.includes(key));

  const pipe = await executeTool('read_file', { path: 'backup.txt' }, { autoApprove: true, canPrompt: false });
  assert.match(pipe, /^Отклонено: /);
  assert.ok(!pipe.includes(key));

  const meta = {};
  const allowed = await executeTool('read_file', { path: 'backup.txt' }, { canPrompt: true, approve: async () => 'yes' }, meta);
  assert.ok(allowed.includes(key));
  assert.strictEqual(meta.secret, true);
});

test('секреты в содержимом: номер строки считается от начала файла при чтении по offset', async () => {
  const filler = 'x\n'.repeat(30000);
  await fs.writeFile('long.log', `${filler}-----BEGIN RSA PRIVATE KEY-----\n`, 'utf8');
  let request;
  const toolCtx = { canPrompt: true, approve: async (r) => { request = r; return 'no'; } };

  await executeTool('read_file', { path: 'long.log', offset: 40000 }, toolCtx);
  assert.ok(request.preview.some(p => p.text.includes('приватный ключ, строка 30001')), JSON.stringify(request.preview));
});

test('обычный код и заглушки не считаются секретами', async () => {
  const toolCtx = { autoApprove: false, canPrompt: false };
  const samples = [
    'API_KEY=your_api_key_here',
    'API_KEY=process.env.API_KEY',
    'SECRET_KEY=${SECRET_KEY}',
    'TOKEN_TTL=3600',
    'DATABASE_URL=postgres://user:${DB_PASS}@localhost/app',
    'DATABASE_URL=postgres://localhost:5432/app',
    'const password = getPassword();',
    'sk-short'
  ];
  for (const [i, text] of samples.entries()) {
    const name = `safe${i}.txt`;
    await fs.writeFile(name, text, 'utf8');
    assert.strictEqual(await executeTool('read_file', { path: name }, toolCtx), text, text);
  }
});

test('секреты в содержимом: разные виды находятся', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const samples = [
    'key: AKIAIOSFODNN7EXAMPLE',
    `sk-or-v1-${'f'.repeat(40)}`,
    `AIza${'B'.repeat(35)}`,
    'export DB_PASSWORD="s3cr3t-Value"',
    'mysql://root:hunter2pass@db.internal/prod',
    '-----BEGIN OPENSSH PRIVATE KEY-----'
  ];
  for (const [i, text] of samples.entries()) {
    const name = `leak${i}.txt`;
    await fs.writeFile(name, text, 'utf8');
    assert.match(await executeTool('read_file', { path: name }, toolCtx), /^Отклонено: /, text);
  }
});

test('каталог чекпоинтов с копиями секретов недоступен инструментам, в том числе при своём XDG_STATE_HOME', async () => {
  const dir = path.join('state', 'duddy', 'checkpoints', '1-1', 'files');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '0'), 'копия', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: true, approve: async () => 'yes' };

  const read = await executeTool('read_file', { path: path.join(dir, '0') }, toolCtx);
  assert.match(read, /^Ошибка: Доступ запрещён/);
  const removed = await executeTool('delete_folder', { path: 'state/duddy/checkpoints' }, toolCtx);
  assert.match(removed, /^Ошибка: Доступ запрещён/);
  assert.ok(fsSync.existsSync(dir));
});
