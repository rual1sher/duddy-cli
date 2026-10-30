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

test('read_file обрезает файл длиннее 40000 символов', async () => {
  const toolCtx = { autoApprove: true, canPrompt: false };
  const longContent = 'A'.repeat(40050);
  await fs.writeFile('huge.txt', longContent, 'utf8');

  const res = await executeTool('read_file', { path: 'huge.txt' }, toolCtx);
  assert.strictEqual(
    res,
    'A'.repeat(40000) + '\n\n...[Обрезано: файл слишком большой (40050 байт)]...'
  );
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
