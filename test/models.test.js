import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-models-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

after(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // cleanup
  }
});

const {
  isTemporaryOverload,
  classifyModelError,
  markModelBusy,
  isModelBusy,
  clearModelBusy
} = await import('../src/models/status.js');

const { isCodeUnfit } = await import('../src/models/filters.js');
const { errorHint } = await import('../src/errors.js');

test('isTemporaryOverload возвращает true для 503 и false для 400 без перегрузки', () => {
  assert.strictEqual(isTemporaryOverload(503), true);
  assert.strictEqual(isTemporaryOverload(400, 'Bad request'), false);
  assert.strictEqual(isTemporaryOverload(400, 'model is overloaded'), true);
});

test('classifyModelError определяет типовые ошибки по статусу и сообщению', () => {
  assert.strictEqual(classifyModelError(402, 'insufficient credits'), 'plan');
  assert.strictEqual(classifyModelError(200, 'User location is not supported in your region'), 'region');
  assert.strictEqual(classifyModelError(404, 'The model was not found'), 'retired');
  assert.strictEqual(classifyModelError(403), 'restricted');
  assert.strictEqual(classifyModelError(403, "team doesn't have any credits"), null);
  assert.strictEqual(classifyModelError(403, 'forbidden'), 'restricted');
  assert.strictEqual(classifyModelError(400, 'Invalid API key provided'), null);
});

test('markModelBusy, isModelBusy и clearModelBusy корректно управляют статусом занятости', () => {
  const provider = 'openrouter';
  const id = 'test/model-alpha';

  assert.strictEqual(isModelBusy(provider, id), false);

  markModelBusy(provider, id);
  assert.strictEqual(isModelBusy(provider, id), true);

  clearModelBusy(provider, id);
  assert.strictEqual(isModelBusy(provider, id), false);
});

test('isCodeUnfit определяет модели, непригодные для работы с кодом', () => {
  // Модель меньше 20B параметров
  assert.strictEqual(isCodeUnfit('meta-llama/llama-3-8b-instruct'), true);
  // Модель из линейки flash-lite
  assert.strictEqual(isCodeUnfit('google/gemini-2.0-flash-lite'), true);
  // Модель префикса liquid/
  assert.strictEqual(isCodeUnfit('liquid/lfm-40b'), true);
  // Полноценная модель с кодом >= 20B
  assert.strictEqual(isCodeUnfit('qwen/qwen-2.5-coder-32b-instruct'), false);
});

test('errorHint для 403 с текстом про credits даёт подсказку про баланс xAI, а не «Ключ не подошёл»', () => {
  const err = { status: 403, message: "team doesn't have any credits" };
  const session = { provider: 'xai', apiKey: 'k' };
  const hint = errorHint(err, session);
  assert.strictEqual(hint, 'На балансе xAI недостаточно средств — пополните счёт или выберите другую модель через /model');
});
