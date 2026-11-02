import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitFailedTurn } from '../src/history.js';

test('400 при пустом partial: возвращает false, сообщения пользователя нет в session.messages, а старый tool-результат на 5000 символов обрезан', () => {
  const session = {
    messages: [
      { role: 'user', content: 'старый запрос' },
      { role: 'tool', content: 'x'.repeat(5000) }
    ]
  };
  const err = new Error('Bad Request');
  err.status = 400;
  err.partialMessages = [];

  const kept = commitFailedTurn(session, 'новый запрос', err);

  assert.strictEqual(kept, false);
  assert.strictEqual(session.messages.length, 2);
  assert.strictEqual(session.messages[0].content, 'старый запрос');
  assert.ok(session.messages[1].content.length < 5000);
  assert.ok(session.messages[1].content.endsWith('...[результат обрезан в истории]'));
});

test('400 с partial, где tool-результат на 5000 символов: возвращает true, результат в истории обрезан', () => {
  const session = { messages: [] };
  const err = new Error('Bad Request');
  err.status = 400;
  err.partialMessages = [
    { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'f' } }] },
    { role: 'tool', content: 'y'.repeat(5000) }
  ];

  const kept = commitFailedTurn(session, 'новый запрос', err);

  assert.strictEqual(kept, true);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[0].content, 'новый запрос');
  const toolMsg = session.messages.find(m => m.role === 'tool');
  assert.ok(toolMsg);
  assert.ok(toolMsg.content.length < 5000);
  assert.ok(toolMsg.content.endsWith('...[результат обрезан в истории]'));
});

test('ошибка без status с partial [assistant с текстом]: заглушка (ход прерван: ответ не получен) НЕ добавлена', () => {
  const session = { messages: [] };
  const err = new Error('Connection reset');
  err.partialMessages = [
    { role: 'assistant', content: 'Частичный ответ\n\n(ответ оборван)' }
  ];

  const kept = commitFailedTurn(session, 'мой запрос', err);

  assert.strictEqual(kept, true);
  assert.strictEqual(session.messages.length, 2);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[1].role, 'assistant');
  assert.strictEqual(session.messages[1].content, 'Частичный ответ\n\n(ответ оборван)');
  assert.strictEqual(session.messages.some(m => m.content === '(ход прерван: ответ не получен)'), false);
});

test('ошибка без status и без partial: сообщение пользователя и заглушка добавлены', () => {
  const session = { messages: [] };
  const err = new Error('Connection reset');

  const kept = commitFailedTurn(session, 'мой запрос', err);

  assert.strictEqual(kept, true);
  assert.strictEqual(session.messages.length, 2);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[0].content, 'мой запрос');
  assert.strictEqual(session.messages[1].role, 'assistant');
  assert.strictEqual(session.messages[1].content, '(ход прерван: ответ не получен)');
});

test('AbortError без partialMessages: ход сохранён', () => {
  const session = { messages: [] };
  const err = new Error('Request was aborted.');
  err.name = 'AbortError';

  const kept = commitFailedTurn(session, 'мой запрос', err);

  assert.strictEqual(kept, true);
  assert.strictEqual(session.messages.length, 2);
  assert.strictEqual(session.messages[0].role, 'user');
  assert.strictEqual(session.messages[0].content, 'мой запрос');
  assert.strictEqual(session.messages[1].role, 'assistant');
  assert.strictEqual(session.messages[1].content, '(ход прерван: ответ не получен)');
});
