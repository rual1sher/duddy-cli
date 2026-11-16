import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOOLS } from '../src/tools/definitions.js';

test('схема AGENT_TOOLS компактна: длина JSON <= 2300 символов', () => {
  const json = JSON.stringify(AGENT_TOOLS);
  assert.ok(json.length <= 2300, `Длина схемы ${json.length} превышает 2300`);
});

test('каждый инструмент содержит type: function, name, description и parameters', () => {
  assert.ok(Array.isArray(AGENT_TOOLS) && AGENT_TOOLS.length > 0);
  for (const tool of AGENT_TOOLS) {
    assert.strictEqual(tool.type, 'function');
    assert.ok(tool.function, 'tool.function отсутствует');
    assert.ok(typeof tool.function.name === 'string' && tool.function.name.length > 0, 'name отсутствует');
    assert.ok(typeof tool.function.description === 'string' && tool.function.description.length > 0, 'description отсутствует');
    assert.ok(tool.function.parameters && typeof tool.function.parameters === 'object', 'parameters отсутствует');
    assert.strictEqual(tool.function.parameters.type, 'object');
    assert.ok(tool.function.parameters.properties && typeof tool.function.parameters.properties === 'object');
  }
});
