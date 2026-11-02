import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем XDG_STATE_HOME до импортов, чтобы checkpoints писались во временную папку
const tmpStateHome = fsSync.mkdtempSync(path.join(os.tmpdir(), 'duddy-cp-state-'));
process.env.XDG_STATE_HOME = tmpStateHome;

const { createCheckpoint, undoLastCheckpoint } = await import('../src/tools/checkpoints.js');
const { executeTool } = await import('../src/tools/execute.js');

const originalCwd = process.cwd();
let testTmpDir;

before(async () => {
  // Убеждаемся, что папка чекпоинтов создана
});

after(async () => {
  process.chdir(originalCwd);
  try {
    await fs.rm(tmpStateHome, { recursive: true, force: true });
  } catch { /* ignore */ }
});

beforeEach(async () => {
  testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-cp-test-'));
  const real = await fs.realpath(testTmpDir);
  process.chdir(real);
  testTmpDir = real;
});

afterEach(async () => {
  process.chdir(originalCwd);
  try {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

/** Создаёт toolCtx для одного хода */
function makeCtx() {
  const cwd = fsSync.realpathSync(process.cwd());
  return {
    autoApprove: true,
    canPrompt: false,
    checkpoint: createCheckpoint(cwd),
    fullyRead: new Map()
  };
}

/** Читает файл через executeTool и возвращает содержимое (строку) */
async function toolRead(relPath, ctx) {
  return executeTool('read_file', { path: relPath }, ctx);
}

/** Пишет файл через executeTool */
async function toolCreate(relPath, content, ctx) {
  return executeTool('create_file', { path: relPath, content }, ctx);
}

/** Редактирует файл через executeTool */
async function toolEdit(relPath, oldContent, newContent, ctx) {
  return executeTool('edit_file', { path: relPath, old_content: oldContent, new_content: newContent }, ctx);
}

/** Удаляет файл через executeTool */
async function toolDeleteFile(relPath, ctx) {
  return executeTool('delete_file', { path: relPath }, ctx);
}

/** Удаляет папку через executeTool */
async function toolDeleteFolder(relPath, ctx) {
  return executeTool('delete_folder', { path: relPath }, ctx);
}

test('1. откат edit_file', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('hello.txt', 'original content', 'utf8');

  const ctx = makeCtx();
  await toolRead('hello.txt', ctx);
  const r = await toolEdit('hello.txt', 'original content', 'modified content', ctx);
  assert.ok(r.includes('изменен'), `edit_file должен вернуть успех, получено: ${r}`);

  const afterEdit = await fs.readFile('hello.txt', 'utf8');
  assert.strictEqual(afterEdit, 'modified content');

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0, `конфликтов не должно быть: ${JSON.stringify(result.conflicts)}`);
  assert.ok(result.restored.includes('hello.txt'));

  const afterUndo = await fs.readFile('hello.txt', 'utf8');
  assert.strictEqual(afterUndo, 'original content');
});

test('2. откат create_file нового файла — файл исчезает', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  const ctx = makeCtx();
  const r = await toolCreate('newfile.txt', 'hello new', ctx);
  assert.ok(r.includes('создан'), `должен быть создан: ${r}`);
  assert.ok(fsSync.existsSync('newfile.txt'));

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);
  assert.ok(result.restored.includes('newfile.txt'));
  assert.strictEqual(fsSync.existsSync('newfile.txt'), false, 'файл должен исчезнуть после отката');
});

test('3. откат delete_file', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('todelete.txt', 'precious data', 'utf8');

  const ctx = makeCtx();
  const r = await toolDeleteFile('todelete.txt', ctx);
  assert.ok(r.includes('удален'), `должен быть удалён: ${r}`);
  assert.strictEqual(fsSync.existsSync('todelete.txt'), false);

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);
  assert.ok(result.restored.includes('todelete.txt'));
  const restored = await fs.readFile('todelete.txt', 'utf8');
  assert.strictEqual(restored, 'precious data');
});

test('4. откат delete_folder с вложенными файлами и вложенной папкой', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.mkdir('mydir/sub', { recursive: true });
  await fs.writeFile('mydir/a.txt', 'aaa', 'utf8');
  await fs.writeFile('mydir/sub/b.txt', 'bbb', 'utf8');

  const ctx = makeCtx();
  const r = await toolDeleteFolder('mydir', ctx);
  assert.ok(r.includes('удалена'), `должна быть удалена: ${r}`);
  assert.strictEqual(fsSync.existsSync('mydir'), false);

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);

  // Папка восстановлена
  assert.ok(fsSync.existsSync('mydir'), 'папка должна восстановиться');
  assert.strictEqual(await fs.readFile('mydir/a.txt', 'utf8'), 'aaa');
  assert.strictEqual(await fs.readFile('mydir/sub/b.txt', 'utf8'), 'bbb');
});

test('5. файл изменён и удалён в одном ходе: возвращается исходная версия', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('multi.txt', 'v1', 'utf8');

  const ctx = makeCtx();
  await toolRead('multi.txt', ctx);
  await toolEdit('multi.txt', 'v1', 'v2', ctx);
  await toolDeleteFile('multi.txt', ctx);

  assert.strictEqual(fsSync.existsSync('multi.txt'), false);

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);

  const restored = await fs.readFile('multi.txt', 'utf8');
  assert.strictEqual(restored, 'v1');
});

test('6. файл удалён и создан заново в одном ходе: возвращается исходная версия', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('recreate.txt', 'original', 'utf8');

  const ctx = makeCtx();
  await toolDeleteFile('recreate.txt', ctx);
  // Создаём заново (нет предыдущего read_file, но файла не существует — ок)
  await toolCreate('recreate.txt', 'new version', ctx);

  const afterTurn = await fs.readFile('recreate.txt', 'utf8');
  assert.strictEqual(afterTurn, 'new version');

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);

  const restored = await fs.readFile('recreate.txt', 'utf8');
  assert.strictEqual(restored, 'original');
});

test('7. создан и удалён в одном ходе: файла нет, ошибок нет', async () => {
  const cwd = fsSync.realpathSync(process.cwd());

  const ctx = makeCtx();
  await toolCreate('temp.txt', 'temporary', ctx);
  await toolDeleteFile('temp.txt', ctx);

  assert.strictEqual(fsSync.existsSync('temp.txt'), false);

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);
  // Файл не должен появиться (его не было до хода)
  assert.strictEqual(fsSync.existsSync('temp.txt'), false, 'файл не должен появиться');
});

test('8. правка через симлинк: после отката симлинк остаётся, цель содержит исходный текст', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('real.txt', 'real content', 'utf8');
  await fs.symlink('real.txt', 'link.txt');

  const ctx = makeCtx();
  await toolRead('link.txt', ctx);
  const r = await toolEdit('link.txt', 'real content', 'edited via link', ctx);
  assert.ok(r.includes('изменен'), `edit через симлинк должен работать: ${r}`);

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);

  // Симлинк должен остаться симлинком
  const linkStat = await fs.lstat('link.txt');
  assert.ok(linkStat.isSymbolicLink(), 'link.txt должен остаться симлинком');

  // Цель содержит исходный текст
  const targetContent = await fs.readFile('real.txt', 'utf8');
  assert.strictEqual(targetContent, 'real content');
});

test('9. удаление симлинка на файл: после отката снова симлинк, цель не тронута', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('target.txt', 'target content', 'utf8');
  await fs.symlink('target.txt', 'mylink.txt');

  const ctx = makeCtx();
  const r = await toolDeleteFile('mylink.txt', ctx);
  assert.ok(r.includes('удален'), `симлинк должен быть удалён: ${r}`);
  assert.strictEqual(fsSync.existsSync('mylink.txt'), false);
  // Цель не тронута
  assert.ok(fsSync.existsSync('target.txt'));
  assert.strictEqual(await fs.readFile('target.txt', 'utf8'), 'target content');

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.length === 0);

  // Симлинк восстановлен
  const linkStat = await fs.lstat('mylink.txt');
  assert.ok(linkStat.isSymbolicLink(), 'mylink.txt должен снова быть симлинком');
  // Цель не тронута
  assert.strictEqual(await fs.readFile('target.txt', 'utf8'), 'target content');
});

test('10. конфликт: файл изменён после хода', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('conflict.txt', 'before', 'utf8');

  const ctx = makeCtx();
  await toolRead('conflict.txt', ctx);
  await toolEdit('conflict.txt', 'before', 'after turn', ctx);

  // Изменяем файл после хода
  await fs.writeFile('conflict.txt', 'changed by user', 'utf8');

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.includes('conflict.txt'), `конфликт должен быть: ${JSON.stringify(result.conflicts)}`);
  assert.notStrictEqual(result.backupDir, null, 'backupDir должен быть не null');
  assert.ok(fsSync.existsSync(result.backupDir), 'backupDir должен существовать');

  // Файл не тронут
  const content = await fs.readFile('conflict.txt', 'utf8');
  assert.strictEqual(content, 'changed by user');

  // Следующий undo идёт к предыдущему чекпоинту (или null, если его нет)
  const result2 = await undoLastCheckpoint(cwd);
  assert.strictEqual(result2, null, 'следующий undo должен вернуть null (нет предыдущего хода)');
});

test('11. конфликт при откате удаления: на месте появился новый файл', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('was.txt', 'old data', 'utf8');

  const ctx = makeCtx();
  await toolDeleteFile('was.txt', ctx);

  // На месте удалённого появился новый файл
  await fs.writeFile('was.txt', 'new file by user', 'utf8');

  const result = await undoLastCheckpoint(cwd);
  assert.ok(result !== null);
  assert.ok(result.conflicts.includes('was.txt'));
  assert.notStrictEqual(result.backupDir, null);

  // Новый файл пользователя не тронут
  const content = await fs.readFile('was.txt', 'utf8');
  assert.strictEqual(content, 'new file by user');

  // Копия старого лежит в backupDir
  assert.ok(fsSync.existsSync(result.backupDir), 'backupDir должен существовать');
});

test('12. без конфликтов каталог чекпоинта удаляется, повторный undo — предыдущий ход, третий — null', async () => {
  const cwd = fsSync.realpathSync(process.cwd());

  // Ход 1
  await fs.writeFile('f1.txt', 'v1', 'utf8');
  const ctx1 = makeCtx();
  await toolRead('f1.txt', ctx1);
  await toolEdit('f1.txt', 'v1', 'v1-edited', ctx1);

  // Ход 2
  await fs.writeFile('f2.txt', 'v2', 'utf8');
  const ctx2 = makeCtx();
  await toolRead('f2.txt', ctx2);
  await toolEdit('f2.txt', 'v2', 'v2-edited', ctx2);

  // Откат хода 2
  const res1 = await undoLastCheckpoint(cwd);
  assert.ok(res1 !== null);
  assert.ok(res1.conflicts.length === 0);
  assert.strictEqual(await fs.readFile('f2.txt', 'utf8'), 'v2');

  // Откат хода 1
  const res2 = await undoLastCheckpoint(cwd);
  assert.ok(res2 !== null);
  assert.ok(res2.conflicts.length === 0);
  assert.strictEqual(await fs.readFile('f1.txt', 'utf8'), 'v1');

  // Третий undo — null
  const res3 = await undoLastCheckpoint(cwd);
  assert.strictEqual(res3, null);
});

test('13. ротация: 25 ходов оставляют ровно 20 каталогов', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('rot.txt', 'init', 'utf8');

  for (let i = 0; i < 25; i++) {
    const ctx = makeCtx();
    // Каждый ход делает снапшот файла
    await toolRead('rot.txt', ctx);
    await toolEdit('rot.txt', await fs.readFile('rot.txt', 'utf8'), `v${i}`, ctx);
  }

  const stateDir = path.join(tmpStateHome, 'duddy', 'checkpoints');
  const entries = await fs.readdir(stateDir);
  const cpDirs = entries.filter(e => /^\d+-\d+$/.test(e));
  assert.strictEqual(cpDirs.length, 20, `должно остаться 20 чекпоинтов, есть: ${cpDirs.length}`);
});

test('14. undo из другой папки возвращает null, чужие чекпоинты целы', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('mine.txt', 'mine', 'utf8');

  const ctx = makeCtx();
  await toolCreate('newfile2.txt', 'content', ctx);

  // Другая папка
  const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-other-'));
  const otherReal = await fs.realpath(otherDir);

  try {
    const result = await undoLastCheckpoint(otherReal);
    assert.strictEqual(result, null, 'undo из другой папки должен вернуть null');

    // Наш чекпоинт цел
    const our = await undoLastCheckpoint(cwd);
    assert.ok(our !== null, 'наш чекпоинт должен быть цел');
  } finally {
    await fs.rm(otherDir, { recursive: true, force: true });
  }
});

test('15. ход без записей не создаёт каталогов', async () => {
  const cwd = fsSync.realpathSync(process.cwd());

  // Получаем текущее кол-во каталогов
  const stateDir = path.join(tmpStateHome, 'duddy', 'checkpoints');
  const before = await fs.readdir(stateDir).catch(() => []);
  const countBefore = before.filter(e => /^\d+-\d+$/.test(e)).length;

  // Ход без записей — просто создаём ctx и ничего не делаем
  makeCtx();

  // Небольшая задержка, чтобы убедиться
  await new Promise(r => setTimeout(r, 50));

  const after2 = await fs.readdir(stateDir).catch(() => []);
  const countAfter = after2.filter(e => /^\d+-\d+$/.test(e)).length;

  assert.strictEqual(countAfter, countBefore, 'ход без записей не должен создавать каталог');
});

test('16. права: каталог чекпоинта 0o700, копии файлов 0o600', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('perms.txt', 'data', 'utf8');

  const ctx = makeCtx();
  await toolRead('perms.txt', ctx);
  await toolEdit('perms.txt', 'data', 'changed', ctx);

  const stateDir = path.join(tmpStateHome, 'duddy', 'checkpoints');
  const entries = await fs.readdir(stateDir);
  const cpDirs = entries.filter(e => /^\d+-\d+$/.test(e)).sort();
  const latestCpDir = path.join(stateDir, cpDirs[cpDirs.length - 1]);

  // Права каталога 0o700
  const cpStat = await fs.stat(latestCpDir);
  assert.strictEqual(cpStat.mode & 0o777, 0o700, 'каталог чекпоинта должен иметь права 0o700');

  // Права копии файла 0o600
  const filesDir = path.join(latestCpDir, 'files');
  const fileEntries = await fs.readdir(filesDir);
  for (const fe of fileEntries) {
    const fStat = await fs.stat(path.join(filesDir, fe));
    assert.strictEqual(fStat.mode & 0o777, 0o600, `копия файла ${fe} должна иметь права 0o600`);
  }
});

test('17. ошибка снимка прерывает запись: edit_file возвращает ошибку, файл не изменён', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('fragile.txt', 'untouched', 'utf8');

  const ctx = makeCtx();
  // Подменяем checkpoint на объект, у которого snapshot бросает ошибку
  ctx.checkpoint = {
    async snapshot() { throw new Error('snapshot error'); },
    async markWritten() {},
    async moveToBackup() {}
  };

  await toolRead('fragile.txt', ctx);
  const r = await toolEdit('fragile.txt', 'untouched', 'should not be written', ctx);
  assert.ok(r.startsWith('Ошибка') || r.includes('Ошибка'), `должна быть ошибка, получено: ${r}`);

  // Файл не изменён
  const content = await fs.readFile('fragile.txt', 'utf8');
  assert.strictEqual(content, 'untouched');
});

test('18. запись с путём вне cwd в manifest не восстанавливается и попадает в conflicts', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-cp-outside-')));
  const outsideFile = path.join(outsideDir, 'victim.txt');
  await fs.writeFile(outsideFile, 'не трогать', 'utf8');

  // Создаём "нормальный" ход, чтобы был каталог чекпоинта
  await fs.writeFile('normal.txt', 'normal', 'utf8');
  const ctx = makeCtx();
  await toolRead('normal.txt', ctx);
  await toolEdit('normal.txt', 'normal', 'changed', ctx);

  // Находим каталог чекпоинта
  const stateDir = path.join(tmpStateHome, 'duddy', 'checkpoints');
  const entries = await fs.readdir(stateDir);
  const cpDirs = entries.filter(e => /^\d+-\d+$/.test(e)).sort();
  const latestCpDir = path.join(stateDir, cpDirs[cpDirs.length - 1]);

  // Копия существует, поэтому без проверки пути откат записал бы её поверх чужого файла
  await fs.writeFile(path.join(latestCpDir, 'files', '999'), 'подмена', 'utf8');
  const manifestPath = path.join(latestCpDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.entries.push({ path: outsideFile, existed: true, backup: 'files/999' });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  try {
    const result = await undoLastCheckpoint(cwd);
    assert.deepStrictEqual(result.conflicts, [path.relative(cwd, outsideFile)]);
    assert.strictEqual(await fs.readFile(outsideFile, 'utf8'), 'не трогать');
    assert.strictEqual(await fs.readFile('normal.txt', 'utf8'), 'normal');
  } finally {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test('19. файл изменён, удалён и создан заново в одном ходе: возвращается исходная версия без конфликтов', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('cycle.txt', 'исходный', 'utf8');

  const ctx = makeCtx();
  await toolRead('cycle.txt', ctx);
  await toolEdit('cycle.txt', 'исходный', 'правка', ctx);
  await toolDeleteFile('cycle.txt', ctx);
  await toolCreate('cycle.txt', 'заново', ctx);

  const result = await undoLastCheckpoint(cwd);
  assert.deepStrictEqual(result.conflicts, []);
  assert.strictEqual(await fs.readFile('cycle.txt', 'utf8'), 'исходный');
});

test('20. папка удалена и воссоздана с тем же файлом: откат без конфликтов', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.mkdir('pkg');
  await fs.writeFile('pkg/a.txt', 'исходный', 'utf8');

  const ctx = makeCtx();
  await toolRead('pkg/a.txt', ctx);
  await toolEdit('pkg/a.txt', 'исходный', 'правка', ctx);
  await toolDeleteFolder('pkg', ctx);
  await toolCreate('pkg/a.txt', 'заново', ctx);

  const result = await undoLastCheckpoint(cwd);
  assert.deepStrictEqual(result.conflicts, []);
  assert.strictEqual(await fs.readFile('pkg/a.txt', 'utf8'), 'исходный');
});

test('21. настоящая ошибка копирования при снимке прерывает запись, файл не считается новым', async () => {
  const cwd = fsSync.realpathSync(process.cwd());
  await fs.writeFile('locked.txt', 'данные', { mode: 0o000 });

  const checkpoint = createCheckpoint(cwd);
  try {
    await assert.rejects(checkpoint.snapshot(path.join(cwd, 'locked.txt')), { code: 'EACCES' });
  } finally {
    await fs.chmod('locked.txt', 0o600);
  }
  assert.strictEqual(await undoLastCheckpoint(cwd), null);
  assert.strictEqual(await fs.readFile('locked.txt', 'utf8'), 'данные');
});

test('22. перенос на другое устройство сохраняет файлы и относительные симлинки', async (t) => {
  if (!fsSync.existsSync('/dev/shm')) return t.skip('нет /dev/shm');
  const shmState = await fs.mkdtemp('/dev/shm/duddy-cp-');
  if (fsSync.statSync(shmState).dev === fsSync.statSync(process.cwd()).dev) {
    await fs.rm(shmState, { recursive: true, force: true });
    return t.skip('рабочая папка на том же устройстве');
  }

  const cwd = fsSync.realpathSync(process.cwd());
  process.env.XDG_STATE_HOME = shmState;
  try {
    await fs.mkdir('tree');
    await fs.writeFile('tree/a.txt', 'a', 'utf8');
    await fs.symlink('a.txt', 'tree/link');

    await toolDeleteFolder('tree', makeCtx());
    assert.strictEqual(fsSync.existsSync('tree'), false);

    const result = await undoLastCheckpoint(cwd);
    assert.deepStrictEqual(result.conflicts, []);
    assert.strictEqual(await fs.readlink('tree/link'), 'a.txt');
    assert.strictEqual(await fs.readFile('tree/link', 'utf8'), 'a');
  } finally {
    process.env.XDG_STATE_HOME = tmpStateHome;
    await fs.rm(shmState, { recursive: true, force: true });
  }
});
