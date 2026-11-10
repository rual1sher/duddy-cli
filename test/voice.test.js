import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

// Подменяем HOME до динамического импорта, чтобы config.js и paths.js взяли наш путь
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'duddy-voice-test-'));
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

const { cleanTextForSpeech } = await import('../src/voice/cleanText.js');
const { getVoicePaths, isVoiceAvailable, getVoiceStatus } = await import('../src/voice/paths.js');
const { AVAILABLE_COMMANDS } = await import('../src/session-actions.js');
const { loadConfig } = await import('../src/config.js');

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

test('cleanTextForSpeech: my_var_name и config_file.js не меняются; **жирный**, *курсив*, __жирный__, _курсив_ очищаются; 2 * 3 * 4 не меняется', () => {
  assert.equal(cleanTextForSpeech('my_var_name'), 'my_var_name');
  assert.equal(cleanTextForSpeech('config_file.js'), 'config_file.js');
  assert.equal(cleanTextForSpeech('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(cleanTextForSpeech('**жирный**'), 'жирный');
  assert.equal(cleanTextForSpeech('*курсив*'), 'курсив');
  assert.equal(cleanTextForSpeech('__жирный__'), 'жирный');
  assert.equal(cleanTextForSpeech('_курсив_'), 'курсив');
  assert.equal(cleanTextForSpeech('Строка с my_var_name и **важным** текстом'), 'Строка с my_var_name и важным текстом');
});

test('voice: getVoicePaths возвращает корректную структуру путей', () => {
  const paths = getVoicePaths();
  assert.ok(paths.voiceDir.endsWith('.config/duddy/voice'));
  assert.ok(paths.piperBin.includes('piper'));
  assert.ok(paths.whisperBin.includes('whisper-cli'));
  assert.ok(paths.piperModel.endsWith('.onnx'));
  assert.ok(paths.piperConfig.endsWith('.onnx.json'));
  assert.ok(paths.whisperModel.endsWith('.bin'));
});

test('voice: статус и доступность возвращают булевы значения', () => {
  const status = getVoiceStatus();
  assert.equal(typeof status.available, 'boolean');
  assert.equal(typeof status.piper, 'boolean');
  assert.equal(typeof status.whisper, 'boolean');
  assert.equal(typeof status.piperConfig, 'boolean');
  assert.equal(isVoiceAvailable(), status.available);
});

test('voice: isVoiceAvailable и getVoiceStatus учитывают piperConfig', () => {
  const paths = getVoicePaths();
  fs.mkdirSync(paths.piperDir, { recursive: true });
  fs.mkdirSync(paths.whisperDir, { recursive: true });
  fs.mkdirSync(paths.modelsDir, { recursive: true });

  fs.writeFileSync(paths.piperBin, '');
  fs.writeFileSync(paths.whisperBin, '');
  fs.writeFileSync(paths.piperModel, '');
  fs.writeFileSync(paths.whisperModel, '');

  // Без piperConfig - недоступен
  try { fs.rmSync(paths.piperConfig, { force: true }); } catch {}
  let status = getVoiceStatus();
  assert.equal(status.piperConfig, false);
  assert.equal(status.available, false);
  assert.equal(isVoiceAvailable(), false);

  // С piperConfig - доступен
  fs.writeFileSync(paths.piperConfig, '{}');
  status = getVoiceStatus();
  assert.equal(status.piperConfig, true);
  assert.equal(status.piperModel, true);
  assert.equal(status.whisperModel, true);
  assert.equal(status.available, true);
  assert.equal(isVoiceAvailable(), true);
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
