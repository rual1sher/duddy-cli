import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools/execute.js';
import { describeToolStart } from '../src/toolDisplay.js';
import { describeToolResult } from '../src/toolResultDisplay.js';

const originalCwd = process.cwd();
let testTmpDir;
let outsideDir;

before(async () => {
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-search-outside-'));
  await fs.writeFile(path.join(outsideDir, 'outside-read.txt'), 'secret outside', 'utf8');
});

after(async () => {
  process.chdir(originalCwd);
  if (outsideDir) {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duddy-search-test-'));
  const realTmpDir = await fs.realpath(testTmpDir);
  process.chdir(realTmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (testTmpDir) {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  }
});

test('1. находит строку с номером, формат path:line: text', async () => {
  await fs.mkdir('src', { recursive: true });
  await fs.writeFile('src/app.js', 'const x = 1;\nconst message = "target string";\nconsole.log(message);\n', 'utf8');

  const res = await executeTool('grep', { pattern: 'target string' });
  assert.strictEqual(res, 'src/app.js:2: const message = "target string";');
});

test('2. регистронезависимый поиск и literal (шаблон a.b не совпадает с axb)', async () => {
  await fs.writeFile('test.txt', 'axb\na.b\nA.B\n', 'utf8');

  const resLiteral = await executeTool('grep', { pattern: 'a.b', literal: true });
  assert.strictEqual(resLiteral, 'test.txt:2: a.b\ntest.txt:3: A.B');

  const resExact = await executeTool('grep', { pattern: 'A.B', literal: true });
  assert.strictEqual(resExact, 'test.txt:3: A.B');

  const resRegex = await executeTool('grep', { pattern: 'a.b' });
  assert.ok(resRegex.includes('test.txt:1: axb'));
  assert.ok(resRegex.includes('test.txt:2: a.b'));

  const resCase = await executeTool('grep', { pattern: 'a.b', literal: true, case_insensitive: true });
  assert.ok(!resCase.includes('test.txt:1: axb'));
  assert.ok(resCase.includes('test.txt:2: a.b'));
  assert.ok(resCase.includes('test.txt:3: A.B'));
});

test('3. шаблон, начинающийся с дефиса (--files), ищется как текст, а не становится флагом', async () => {
  await fs.writeFile('doc.txt', 'Usage: pass --files to show files\nOther line\n', 'utf8');

  const res = await executeTool('grep', { pattern: '--files' });
  assert.strictEqual(res, 'doc.txt:1: Usage: pass --files to show files');
});

test('4. glob-фильтр ограничивает поиск', async () => {
  await fs.writeFile('file1.js', 'find_me in js\n', 'utf8');
  await fs.writeFile('file2.txt', 'find_me in txt\n', 'utf8');

  const res = await executeTool('grep', { pattern: 'find_me', glob: '*.js' });
  assert.strictEqual(res, 'file1.js:1: find_me in js');
  assert.ok(!res.includes('file2.txt'));
});

test('5. .gitignore уважается без git-репозитория, node_modules в .gitignore пропускается', async () => {
  await fs.writeFile('.gitignore', 'node_modules/\nignored.txt\n', 'utf8');
  await fs.mkdir('node_modules/pkg', { recursive: true });
  await fs.writeFile('node_modules/pkg/index.js', 'needle in node_modules\n', 'utf8');
  await fs.writeFile('ignored.txt', 'needle in ignored\n', 'utf8');
  await fs.writeFile('app.js', 'needle in app\n', 'utf8');

  const resGrep = await executeTool('grep', { pattern: 'needle' });
  assert.strictEqual(resGrep, 'app.js:1: needle in app');
  assert.ok(!resGrep.includes('node_modules'));
  assert.ok(!resGrep.includes('ignored.txt'));
});

test('6. .git не просматривается', async () => {
  await fs.mkdir('.git', { recursive: true });
  await fs.writeFile('.git/config', 'GIT_SECRET_DATA_KEY=123\n', 'utf8');
  await fs.writeFile('normal.txt', 'normal file with GIT_SECRET_DATA_KEY\n', 'utf8');

  const resGrep = await executeTool('grep', { pattern: 'GIT_SECRET_DATA_KEY' });
  assert.strictEqual(resGrep, 'normal.txt:1: normal file with GIT_SECRET_DATA_KEY');
  assert.ok(!resGrep.includes('.git'));
});

test('7. .env не находится: ни обычным поиском, ни с glob .env, ни с glob **/* — значение не попадает в результат', async () => {
  await fs.writeFile('.env', 'DB_PASSWORD_SUPER_SECRET=xyz987654\n', 'utf8');
  await fs.writeFile('app.js', 'console.log("hello");\n', 'utf8');

  const resPlain = await executeTool('grep', { pattern: 'DB_PASSWORD_SUPER_SECRET' });
  assert.ok(!resPlain.includes('xyz987654'));
  assert.strictEqual(resPlain, 'Совпадений нет: DB_PASSWORD_SUPER_SECRET');

  const resGlobEnv = await executeTool('grep', { pattern: 'DB_PASSWORD_SUPER_SECRET', glob: '.env' });
  assert.ok(!resGlobEnv.includes('xyz987654'));
  assert.ok(!resGlobEnv.includes('.env:'));
  assert.ok(resGlobEnv.startsWith('Совпадений нет: DB_PASSWORD_SUPER_SECRET'));

  const resGlobAll = await executeTool('grep', { pattern: 'DB_PASSWORD_SUPER_SECRET', glob: '**/*' });
  assert.ok(!resGlobAll.includes('xyz987654'));
  assert.ok(!resGlobAll.includes('.env:'));
  assert.ok(resGlobAll.startsWith('Совпадений нет: DB_PASSWORD_SUPER_SECRET'));
});

test('8. явный path на .env: Ошибка, значения нет', async () => {
  await fs.writeFile('.env', 'API_KEY_VAL=secret_token_12345\n', 'utf8');

  const res = await executeTool('grep', { pattern: 'API_KEY_VAL', path: '.env' });
  assert.strictEqual(
    res,
    'Ошибка: Доступ запрещён — ".env" может содержать секреты, поиск по нему недоступен. Используй read_file, пользователь подтвердит доступ.'
  );
  assert.ok(!res.includes('secret_token_12345'));

  const resGlob = await executeTool('glob', { pattern: '*', path: '.env' });
  assert.strictEqual(
    resGlob,
    'Ошибка: Доступ запрещён — ".env" может содержать секреты, поиск по нему недоступен. Используй read_file, пользователь подтвердит доступ.'
  );
});

test('9. обычный файл с приватным ключом: поиск по base64-строке из тела ключа не показывает её, есть пометка о скрытых файлах', async () => {
  const body = 'MIIEowIBAAKCAQEA0Base64BodyString98765';
  const privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`;
  await fs.writeFile('key.txt', privateKey, 'utf8');

  const res = await executeTool('grep', { pattern: 'Base64BodyString98765' });
  assert.ok(!res.includes('key.txt:'));
  assert.strictEqual(
    res,
    'Совпадений нет: Base64BodyString98765\n...[Скрыто файлов с секретами: 1. Чтобы увидеть их, используй read_file]...'
  );
});

test('10. симлинк с обычным именем на .env не показывает значение (и с glob)', async () => {
  await fs.writeFile('.env', 'SYM_SECRET=super_hidden_val_777\n', 'utf8');
  await fs.symlink('.env', 'innocent.txt');

  const res1 = await executeTool('grep', { pattern: 'SYM_SECRET' });
  assert.ok(!res1.includes('super_hidden_val_777'));
  assert.ok(!res1.includes('innocent.txt:'));

  const res2 = await executeTool('grep', { pattern: 'SYM_SECRET', glob: 'innocent.txt' });
  assert.ok(!res2.includes('super_hidden_val_777'));
  assert.ok(!res2.includes('innocent.txt:'));

  const res3 = await executeTool('grep', { pattern: 'SYM_SECRET', glob: '**/*' });
  assert.ok(!res3.includes('super_hidden_val_777'));
  assert.ok(!res3.includes('innocent.txt:'));

  const resPath = await executeTool('grep', { pattern: 'SYM_SECRET', path: 'innocent.txt' });
  assert.ok(!resPath.includes('super_hidden_val_777'));
  assert.ok(resPath.startsWith('Ошибка: Доступ запрещён — "innocent.txt"'));
});

test('11. файл с токеном ghp_ в обычном файле скрыт целиком', async () => {
  const token = 'ghp_' + 'A1b2'.repeat(10);
  const code = `const token = "${token}";\nfunction calculateTotal() {\n  return 42;\n}\n`;
  await fs.writeFile('service.js', code, 'utf8');

  const res = await executeTool('grep', { pattern: 'calculateTotal' });
  assert.ok(!res.includes('service.js:'));
  assert.strictEqual(
    res,
    'Совпадений нет: calculateTotal\n...[Скрыто файлов с секретами: 1. Чтобы увидеть их, используй read_file]...'
  );
});

test('12. .config/duddy/config.json не находится, в том числе через path и glob', async () => {
  await fs.mkdir('.config/duddy', { recursive: true });
  await fs.writeFile('.config/duddy/config.json', '{"apiKey": "duddy_secret_value_888"}\n', 'utf8');

  const resGrep = await executeTool('grep', { pattern: 'apiKey' });
  assert.ok(!resGrep.includes('duddy_secret_value_888'));
  assert.ok(!resGrep.includes('.config/duddy/config.json:'));

  const resGrepGlob = await executeTool('grep', { pattern: 'apiKey', glob: '**/*' });
  assert.ok(!resGrepGlob.includes('duddy_secret_value_888'));
  assert.ok(!resGrepGlob.includes('.config/duddy/config.json:'));

  const resGrepPath = await executeTool('grep', { pattern: 'apiKey', path: '.config/duddy/config.json' });
  assert.ok(resGrepPath.startsWith('Ошибка: Доступ запрещён'));
  assert.ok(!resGrepPath.includes('duddy_secret_value_888'));

  const resGlobPath = await executeTool('glob', { pattern: '*', path: '.config/duddy' });
  assert.ok(resGlobPath.startsWith('Ошибка: Доступ запрещён'));

  const resGlobAll = await executeTool('glob', { pattern: '*.json' });
  assert.ok(!resGlobAll.includes('.config/duddy'));
});

test('13. path вне рабочей папки: Ошибка', async () => {
  const root = await fs.realpath(process.cwd());

  const resGrep = await executeTool('grep', { pattern: 'secret', path: '../outside' });
  assert.strictEqual(
    resGrep,
    `Ошибка: Доступ запрещён — путь "../outside" находится за пределами рабочей папки ${root}.`
  );

  const resGlob = await executeTool('glob', { pattern: '*', path: '../outside' });
  assert.strictEqual(
    resGlob,
    `Ошибка: Доступ запрещён — путь "../outside" находится за пределами рабочей папки ${root}.`
  );
});

test('14. некорректная регулярка: строка на «Ошибка: некорректный запрос»', async () => {
  const res = await executeTool('grep', { pattern: '(?i[invalid' });
  assert.ok(res.startsWith('Ошибка: некорректный запрос:'));
});

test('15. нет совпадений: «Совпадений нет»', async () => {
  await fs.writeFile('sample.txt', 'hello world\n', 'utf8');
  const res = await executeTool('grep', { pattern: 'missing_pattern_xyz_12345' });
  assert.strictEqual(res, 'Совпадений нет: missing_pattern_xyz_12345');
});

test('16. лимит 100 совпадений и пометка, длинная строка обрезается до 240 символов', async () => {
  for (let f = 1; f <= 6; f++) {
    const lines = [];
    for (let i = 1; i <= 20; i++) {
      lines.push(`MATCH_LIMIT_ITEM file${f}_line${i}`);
    }
    await fs.writeFile(`many_${f}.txt`, lines.join('\n') + '\n', 'utf8');
  }

  const res = await executeTool('grep', { pattern: 'MATCH_LIMIT_ITEM' });
  const allLines = res.split('\n');
  const matchLines = allLines.filter(l => /^many_\d+\.txt:\d+: MATCH_LIMIT_ITEM/.test(l));
  assert.strictEqual(matchLines.length, 100);
  assert.ok(res.includes('...[Показаны первые 100 совпадений. Уточни запрос: pattern, path или glob]...'));

  const longText = 'LONG_' + 'x'.repeat(300);
  await fs.writeFile('long.txt', `${longText}\n`, 'utf8');

  const resLong = await executeTool('grep', { pattern: 'LONG_' });
  const longLine = resLong.split('\n').find(l => l.startsWith('long.txt:1: '));
  assert.ok(longLine);
  const textOnly = longLine.slice('long.txt:1: '.length);
  assert.strictEqual(textOnly, longText.slice(0, 240) + '…');
  assert.strictEqual(textOnly.length, 241);
});

test('17. glob находит файлы и уважает .gitignore, лимит 200 с пометкой, каталог .config/duddy в выводе отсутствует', async () => {
  await fs.mkdir('src', { recursive: true });
  await fs.mkdir('node_modules/pkg', { recursive: true });
  await fs.mkdir('ignored_dir', { recursive: true });
  await fs.mkdir('.config/duddy', { recursive: true });
  await fs.writeFile('.config/duddy/config.json', '{}', 'utf8');
  await fs.writeFile('.gitignore', 'node_modules/\nignored_dir/\n', 'utf8');

  await fs.writeFile('src/app.js', 'ok', 'utf8');
  await fs.writeFile('src/utils.js', 'ok', 'utf8');
  await fs.writeFile('node_modules/pkg/index.js', 'skip', 'utf8');
  await fs.writeFile('ignored_dir/skip.js', 'skip', 'utf8');

  const res1 = await executeTool('glob', { pattern: '*.js' });
  assert.ok(res1.startsWith('Найдено файлов: 2\n'));
  assert.ok(res1.includes('src/app.js'));
  assert.ok(res1.includes('src/utils.js'));
  assert.ok(!res1.includes('node_modules'));
  assert.ok(!res1.includes('ignored_dir'));
  assert.ok(!res1.includes('.config/duddy'));

  await fs.mkdir('limit_dir', { recursive: true });
  for (let i = 0; i < 210; i++) {
    const pad = String(i).padStart(3, '0');
    await fs.writeFile(`limit_dir/file_${pad}.dat`, 'x', 'utf8');
  }

  const resLimit = await executeTool('glob', { pattern: 'file_*.dat' });
  assert.ok(resLimit.startsWith('Найдено файлов: 200\n'));
  assert.ok(resLimit.includes('...[Показаны первые 200. Уточни pattern]...'));
  const fileLines = resLimit.split('\n').filter(l => l.startsWith('limit_dir/file_'));
  assert.strictEqual(fileLines.length, 200);
});

test('18. describeToolResult для grep и glob даёт ожидаемые summary', () => {
  const startGrep = describeToolStart('grep', { pattern: 'my_pattern' });
  assert.strictEqual(startGrep.title, 'Ищет');
  assert.strictEqual(startGrep.target, 'my_pattern');

  const startGlob = describeToolStart('glob', { pattern: '*.js' });
  assert.strictEqual(startGlob.title, 'Ищет файлы');
  assert.strictEqual(startGlob.target, '*.js');

  const resGrepNone = describeToolResult('grep', { pattern: 'search_term' }, 'Совпадений нет: search_term', true);
  assert.strictEqual(resGrepNone.title, 'Поиск');
  assert.strictEqual(resGrepNone.target, 'search_term');
  assert.strictEqual(resGrepNone.summary, 'нет совпадений');

  const resGrepOne = describeToolResult('grep', { pattern: 'foo' }, 'file.js:1: foo', true);
  assert.strictEqual(resGrepOne.title, 'Поиск');
  assert.strictEqual(resGrepOne.target, 'foo');
  assert.strictEqual(resGrepOne.summary, '1 совпадение');

  const resGrepFew = describeToolResult(
    'grep',
    { pattern: 'bar' },
    'file1.js:1: bar\nfile2.js:2: bar\n...[Скрыто файлов с секретами: 1. Чтобы увидеть их, используй read_file]...',
    true
  );
  assert.strictEqual(resGrepFew.summary, '2 совпадения');

  const resGrepMany = describeToolResult(
    'grep',
    { pattern: 'baz' },
    'f1.js:1: b\nf2.js:1: b\nf3.js:1: b\nf4.js:1: b\nf5.js:1: b\n...[Показаны первые 5 совпадений. Уточни запрос: pattern, path или glob]...',
    true
  );
  assert.strictEqual(resGrepMany.summary, '5 совпадений');

  const resGlobNone = describeToolResult('glob', { pattern: '*.xyz' }, 'Файлов нет: *.xyz', true);
  assert.strictEqual(resGlobNone.title, 'Файлы');
  assert.strictEqual(resGlobNone.target, '*.xyz');
  assert.strictEqual(resGlobNone.summary, 'нет файлов');

  const resGlobOne = describeToolResult('glob', { pattern: '*.js' }, 'Найдено файлов: 1\nsrc/index.js', true);
  assert.strictEqual(resGlobOne.title, 'Файлы');
  assert.strictEqual(resGlobOne.target, '*.js');
  assert.strictEqual(resGlobOne.summary, '1 файл');

  const resGlobFew = describeToolResult('glob', { pattern: '*.js' }, 'Найдено файлов: 3\nsrc/a.js\nsrc/b.js\nsrc/c.js', true);
  assert.strictEqual(resGlobFew.summary, '3 файла');

  const resGlobMany = describeToolResult(
    'glob',
    { pattern: '*.js' },
    'Найдено файлов: 200\n...\n...[Показаны первые 200. Уточни pattern]...',
    true
  );
  assert.strictEqual(resGlobMany.summary, '200 файлов');

  const resGrepErr = describeToolResult('grep', { pattern: 'bad' }, 'Ошибка: некорректный запрос: syntax error', false);
  assert.strictEqual(resGrepErr.title, 'Ищет');
  assert.strictEqual(resGrepErr.target, 'bad');
  assert.strictEqual(resGrepErr.summary, 'некорректный запрос: syntax error');

  const resGlobErr = describeToolResult('glob', { pattern: 'bad' }, 'Ошибка: Доступ запрещён', false);
  assert.strictEqual(resGlobErr.title, 'Ищет файлы');
  assert.strictEqual(resGlobErr.target, 'bad');
  assert.strictEqual(resGlobErr.summary, 'Доступ запрещён');
});

test('glob от модели не открывает .git, даже с явным шаблоном', async () => {
  await fs.mkdir('.git');
  await fs.writeFile('.git/config', 'url = plain-text-marker\n', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: false };

  // Шаблон ** заходит в скрытые папки, поэтому важен порядок правил
  for (const glob of ['.git/**', '**']) {
    const grep = await executeTool('grep', { pattern: 'plain-text-marker', glob }, toolCtx);
    assert.ok(!grep.includes('url ='), grep);
    const files = await executeTool('glob', { pattern: glob }, toolCtx);
    assert.ok(!files.includes('.git/config'), files);
  }
});

test('настройки duddy не видны и при поиске от родительской папки', async () => {
  await fs.mkdir('.config/duddy', { recursive: true });
  await fs.writeFile('.config/duddy/config.json', '{"model":"marker-value"}', 'utf8');
  await fs.writeFile('.config/other.json', '{}', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: false };

  for (const args of [{ pattern: '*.json', path: '.config' }, { pattern: '**' }]) {
    const res = await executeTool('glob', args, toolCtx);
    assert.ok(res.includes('.config/other.json'), res);
    assert.ok(!res.includes('duddy/config.json'), res);
  }
  const grep = await executeTool('grep', { pattern: 'marker-value', path: '.config' }, toolCtx);
  assert.ok(!grep.includes('duddy/config.json:'), grep);
});

test('файл, который не удалось проверить на секреты, не показывается', async () => {
  await fs.writeFile('race.txt', 'marker-value\n', 'utf8');
  const realReadFile = fs.readFile;
  const toolCtx = { autoApprove: true, canPrompt: false };

  fs.readFile = async () => { throw new Error('нет доступа'); };
  try {
    const res = await executeTool('grep', { pattern: 'marker-value' }, toolCtx);
    assert.ok(!res.includes('race.txt:1'), res);
    assert.match(res, /Скрыто файлов с секретами: 1/);
  } finally {
    fs.readFile = realReadFile;
  }
});

test('glob-фильтр, начинающийся с дефиса, не становится флагом rg', async () => {
  await fs.writeFile('a.txt', 'marker\n', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: false };
  const res = await executeTool('grep', { pattern: 'marker', glob: '--files' }, toolCtx);
  assert.ok(!res.includes('Найдено файлов'), res);
});

test('без ripgrep инструменты объясняют, что нужно поставить', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const toolCtx = { autoApprove: true, canPrompt: false };
    assert.match(await executeTool('grep', { pattern: 'x' }, toolCtx), /нужен ripgrep/);
    assert.match(await executeTool('glob', { pattern: '*.js' }, toolCtx), /нужен ripgrep/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('слово строчными находит его внутри camelCase, заглавные включают точный регистр', async () => {
  await fs.writeFile('pay.js', 'function applyLoyaltyDiscount() {}\nconst discount = 1;\n', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: false };

  const lower = await executeTool('grep', { pattern: 'loyal' }, toolCtx);
  assert.match(lower, /^pay\.js:1: function applyLoyaltyDiscount/);

  const exact = await executeTool('grep', { pattern: 'Discount' }, toolCtx);
  assert.ok(exact.includes('pay.js:1:') && !exact.includes('pay.js:2:'), exact);
});

test('пустой результат с фильтром подсказывает, как зайти в подпапки', async () => {
  await fs.mkdir('src/deep', { recursive: true });
  await fs.writeFile('src/deep/a.js', 'marker\n', 'utf8');
  const toolCtx = { autoApprove: true, canPrompt: false };

  const res = await executeTool('grep', { pattern: 'marker', glob: 'src/*.js' }, toolCtx);
  assert.match(res, /^Совпадений нет: marker \(с фильтром src\/\*\.js/);
  assert.match(res, /src\/\*\*\/\*\.js/);
  assert.match(await executeTool('grep', { pattern: 'marker', glob: 'src/**/*.js' }, toolCtx), /^src\/deep\/a\.js:1:/);
});
