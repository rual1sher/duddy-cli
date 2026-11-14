import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { toolTarget, describeToolStart } from '../src/toolDisplay.js';

test('toolTarget: абсолютный путь внутри cwd превращается в относительный', () => {
  const cwd = process.cwd();

  // Файлы внутри рабочей папки
  const insideFile = path.join(cwd, 'src', 'server.js');
  assert.strictEqual(toolTarget('edit_file', { path: insideFile }), path.join('src', 'server.js'));
  assert.strictEqual(toolTarget('read_file', { path: insideFile }), path.join('src', 'server.js'));
  assert.strictEqual(toolTarget('create_file', { path: insideFile }), path.join('src', 'server.js'));
  assert.strictEqual(toolTarget('delete_file', { path: insideFile }), path.join('src', 'server.js'));

  // Папки внутри рабочей папки
  const insideFolder = path.join(cwd, 'src');
  assert.strictEqual(toolTarget('create_folder', { path: insideFolder }), 'src');
  assert.strictEqual(toolTarget('delete_folder', { path: insideFolder }), 'src');
  assert.strictEqual(toolTarget('list_dir', { path: insideFolder }), 'src');

  // Корень рабочей папки превращается в '.'
  assert.strictEqual(toolTarget('list_dir', { path: cwd }), '.');
  assert.strictEqual(toolTarget('delete_folder', { path: cwd }), '.');
  assert.strictEqual(toolTarget('read_file', { path: cwd }), '.');
});

test('toolTarget: путь вне cwd остаётся без изменений', () => {
  // Абсолютный путь за пределами cwd
  const outsidePath = path.resolve('/tmp', 'outside-project', 'file.js');
  assert.strictEqual(toolTarget('edit_file', { path: outsidePath }), outsidePath);
  assert.strictEqual(toolTarget('read_file', { path: outsidePath }), outsidePath);
  assert.strictEqual(toolTarget('list_dir', { path: '/tmp' }), '/tmp');
});

test('toolTarget: относительный путь остаётся без изменений', () => {
  assert.strictEqual(toolTarget('edit_file', { path: 'src/server.js' }), 'src/server.js');
  assert.strictEqual(toolTarget('read_file', { path: './package.json' }), './package.json');
  assert.strictEqual(toolTarget('create_file', { path: 'new-file.txt' }), 'new-file.txt');
  assert.strictEqual(toolTarget('list_dir', { path: 'src' }), 'src');
  assert.strictEqual(toolTarget('list_dir', {}), '.');
  assert.strictEqual(toolTarget('list_dir', { path: '' }), '.');
  assert.strictEqual(toolTarget('read_file', {}), '');
});

test('toolTarget: команда bash остаётся без изменений', () => {
  assert.strictEqual(toolTarget('bash', { command: 'npm test' }), 'npm test');
  assert.strictEqual(toolTarget('bash', { command: 'echo hello\necho world' }), 'echo hello');
  assert.strictEqual(toolTarget('bash', {}), '');
});

test('toolTarget: grep и glob возвращают паттерн без изменений', () => {
  const cwd = process.cwd();
  const searchPath = path.join(cwd, 'src');
  assert.strictEqual(toolTarget('grep', { pattern: 'my_pattern', path: searchPath }), 'my_pattern');
  assert.strictEqual(toolTarget('glob', { pattern: '*.js', path: searchPath }), '*.js');
});

test('describeToolStart: формирует заголовок и сокращает абсолютный путь в cwd', () => {
  const cwd = process.cwd();
  const insideFile = path.join(cwd, 'src', 'server.js');
  const start = describeToolStart('edit_file', { path: insideFile });
  assert.strictEqual(start.title, 'Изменяет');
  assert.strictEqual(start.target, path.join('src', 'server.js'));
});
