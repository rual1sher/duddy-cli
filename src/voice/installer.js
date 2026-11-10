/**
 * @fileoverview Автоматическая загрузка и настройка whisper.cpp и Piper TTS
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { VOICE_DIR, MODELS_DIR, PIPER_DIR, WHISPER_DIR, getVoicePaths, isVoiceAvailable } from './paths.js';

const PIPER_RELEASE_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';
const WHISPER_RELEASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz';

const PIPER_MODEL_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx';
const PIPER_CONFIG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx.json';
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

/**
 * Скачивает файл по URL через fetch или curl
 */
async function downloadFile(url, destPath) {
  const tmp = `${destPath}.tmp`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} при скачивании ${url}`);

  const fileStream = fs.createWriteStream(tmp);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
  }

  fileStream.end();
  await new Promise(r => fileStream.on('finish', r));
  fs.renameSync(tmp, destPath);
}

/**
 * Устанавливает компоненты голосового ввода/вывода в ~/.config/duddy/voice/
 * @param {object} [options]
 * @param {(msg: string) => void} [options.onProgress]
 */
export async function installVoice({ onProgress = () => {} } = {}) {
  fs.mkdirSync(VOICE_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(MODELS_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(PIPER_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(WHISPER_DIR, { recursive: true, mode: 0o755 });

  const paths = getVoicePaths();

  // 1. Piper Binary
  if (!fs.existsSync(paths.piperBin)) {
    onProgress('Скачивание Piper TTS…');
    execSync(`curl -sL "${PIPER_RELEASE_URL}" | tar -xz -C "${VOICE_DIR}"`, { stdio: 'inherit' });
    if (fs.existsSync(paths.piperBin)) {
      fs.chmodSync(paths.piperBin, 0o755);
    }
  }

  // 2. Whisper Binary
  if (!fs.existsSync(paths.whisperBin)) {
    onProgress('Скачивание whisper.cpp…');
    execSync(`curl -sL "${WHISPER_RELEASE_URL}" | tar -xz -C "${WHISPER_DIR}" --strip-components=1`, { stdio: 'inherit' });
    if (fs.existsSync(paths.whisperBin)) {
      fs.chmodSync(paths.whisperBin, 0o755);
    }
  }

  // 3. Piper Model
  if (!fs.existsSync(paths.piperModel)) {
    onProgress('Скачивание голоса Piper (ru_RU-dmitri)…');
    await downloadFile(PIPER_MODEL_URL, paths.piperModel);
    await downloadFile(PIPER_CONFIG_URL, paths.piperConfig);
  }

  // 4. Whisper Model
  if (!fs.existsSync(paths.whisperModel)) {
    onProgress('Скачивание модели Whisper (ggml-base)…');
    await downloadFile(WHISPER_MODEL_URL, paths.whisperModel);
  }

  onProgress('Установка голосовых компонентов завершена!');
  return isVoiceAvailable();
}
