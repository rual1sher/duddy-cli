/**
 * @fileoverview Автоматическая загрузка и настройка whisper.cpp и Piper TTS
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { VOICE_DIR, MODELS_DIR, PIPER_DIR, WHISPER_DIR, getVoicePaths, isVoiceAvailable } from './paths.js';

const PIPER_RELEASE_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';
const WHISPER_RELEASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz';

const PIPER_MODEL_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx';
const PIPER_CONFIG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx.json';
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

/**
 * Скачивает файл по URL в целевой путь с использованием потоков и поддержкой backpressure
 *
 * @param {string} url - URL для загрузки
 * @param {string} destPath - Конечный путь сохранения файла
 */
async function downloadFile(url, destPath) {
  const tmp = `${destPath}.tmp`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} при скачивании ${url}`);
    if (!res.body) throw new Error(`Пустое тело ответа при скачивании ${url}`);

    await pipeline(
      Readable.fromWeb(res.body),
      fs.createWriteStream(tmp)
    );
    fs.renameSync(tmp, destPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    } catch {}
    throw err;
  }
}

/**
 * Распаковывает архив tar.gz в указанную директорию
 *
 * @param {string} archivePath - Путь к архиву
 * @param {string} targetDir - Директория для распаковки
 * @param {string[]} [extraArgs=[]] - Дополнительные аргументы tar (например, --strip-components=1)
 * @returns {Promise<void>}
 */
function extractTar(archivePath, targetDir, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', archivePath, '-C', targetDir, ...extraArgs], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
        reject(new Error(`Ошибка распаковки ${path.basename(archivePath)} (код ${code})${detail}`));
      }
    });
  });
}

/**
 * Устанавливает компоненты голосового ввода/вывода в ~/.config/duddy/voice/
 * @param {object} [options]
 * @param {(msg: string) => void} [options.onProgress]
 */
export async function installVoice({ onProgress = () => {} } = {}) {
  if (!(process.platform === 'linux' && process.arch === 'x64')) {
    throw new Error('Автоустановка голоса поддерживается только на Linux x86_64');
  }

  fs.mkdirSync(VOICE_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(MODELS_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(PIPER_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(WHISPER_DIR, { recursive: true, mode: 0o755 });

  const paths = getVoicePaths();

  // 1. Piper Binary
  if (!fs.existsSync(paths.piperBin)) {
    onProgress('Скачивание Piper TTS…');
    const piperArchive = path.join(VOICE_DIR, 'piper.tar.gz');
    try {
      await downloadFile(PIPER_RELEASE_URL, piperArchive);
      await extractTar(piperArchive, VOICE_DIR);
    } finally {
      try {
        if (fs.existsSync(piperArchive)) {
          fs.unlinkSync(piperArchive);
        }
      } catch {}
    }
    if (!fs.existsSync(paths.piperBin)) {
      throw new Error(`Не найден ${paths.piperBin} после распаковки`);
    }
    fs.chmodSync(paths.piperBin, 0o755);
  }

  // 2. Whisper Binary
  if (!fs.existsSync(paths.whisperBin)) {
    onProgress('Скачивание whisper.cpp…');
    const whisperArchive = path.join(VOICE_DIR, 'whisper.tar.gz');
    try {
      await downloadFile(WHISPER_RELEASE_URL, whisperArchive);
      await extractTar(whisperArchive, WHISPER_DIR, ['--strip-components=1']);
    } finally {
      try {
        if (fs.existsSync(whisperArchive)) {
          fs.unlinkSync(whisperArchive);
        }
      } catch {}
    }
    if (!fs.existsSync(paths.whisperBin)) {
      throw new Error(`Не найден ${paths.whisperBin} после распаковки`);
    }
    fs.chmodSync(paths.whisperBin, 0o755);
  }

  // 3. Piper Model
  if (!fs.existsSync(paths.piperModel)) {
    onProgress('Скачивание голоса Piper (ru_RU-dmitri)…');
    await downloadFile(PIPER_MODEL_URL, paths.piperModel);
  }

  // 4. Piper Config
  if (!fs.existsSync(paths.piperConfig)) {
    onProgress('Скачивание конфигурации голоса Piper…');
    await downloadFile(PIPER_CONFIG_URL, paths.piperConfig);
  }

  // 5. Whisper Model
  if (!fs.existsSync(paths.whisperModel)) {
    onProgress('Скачивание модели Whisper (ggml-base)…');
    await downloadFile(WHISPER_MODEL_URL, paths.whisperModel);
  }

  onProgress('Установка голосовых компонентов завершена!');
  return isVoiceAvailable();
}
