import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTextForSpeech } from '../src/voice/cleanText.js';
import { getVoicePaths, isVoiceAvailable, getVoiceStatus } from '../src/voice/paths.js';
import { AVAILABLE_COMMANDS } from '../src/session-actions.js';
import { loadConfig } from '../src/config.js';

test('cleanTextForSpeech: удаляет блоки кода и оставляет читаемый текст', () => {
  const input = 'Вот пример кода:\n```bash\nnpm run build\n```\nЗапустите его в консоли.';
  const output = cleanTextForSpeech(input);
  assert.equal(output.includes('```'), false);
  assert.equal(output.includes('[блок кода пропущен]'), true);
  assert.equal(output.includes('Запустите его в консоли.'), true);
});

test('cleanTextForSpeech: очищает markdown ссылки, заголовки и жирный текст', () => {
  const input = '# Инструкция\nПосетите [сайт](https://example.com) для **подробностей**.';
  const output = cleanTextForSpeech(input);
  assert.equal(output.includes('#'), false);
  assert.equal(output.includes('https://'), false);
  assert.equal(output.includes('**'), false);
  assert.equal(output.includes('Посетите сайт для подробностей.'), true);
});

test('voice: getVoicePaths возвращает корректную структуру путей', () => {
  const paths = getVoicePaths();
  assert.ok(paths.voiceDir.endsWith('.config/duddy/voice'));
  assert.ok(paths.piperBin.includes('piper'));
  assert.ok(paths.whisperBin.includes('whisper-cli'));
  assert.ok(paths.piperModel.endsWith('.onnx'));
  assert.ok(paths.whisperModel.endsWith('.bin'));
});

test('voice: статус и доступность возвращают булевы значения', () => {
  const status = getVoiceStatus();
  assert.equal(typeof status.available, 'boolean');
  assert.equal(typeof status.piper, 'boolean');
  assert.equal(typeof status.whisper, 'boolean');
  assert.equal(isVoiceAvailable(), status.available);
});

test('voice: команда /voice присутствует в списке доступных команд', () => {
  const voiceCmd = AVAILABLE_COMMANDS.find(c => c.cmd === '/voice');
  assert.ok(voiceCmd);
  assert.ok(voiceCmd.desc.includes('/voice'));
});

test('voice: voiceAutoSpeak присутствует в конфигурации по умолчанию', () => {
  const cfg = loadConfig();
  assert.equal(typeof cfg.voiceAutoSpeak, 'boolean');
});
