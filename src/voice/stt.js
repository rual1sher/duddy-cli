/**
 * @fileoverview Локальное распознавание речи (STT) на базе whisper.cpp
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getVoicePaths, isVoiceAvailable } from './paths.js';

let activeRecorder = null;

/**
 * Останавливает текущую запись с микрофона.
 */
export function stopRecording() {
  if (activeRecorder) {
    try {
      activeRecorder.kill('SIGINT');
    } catch {}
    activeRecorder = null;
  }
}

/**
 * Проверяет, идет ли сейчас запись.
 * @returns {boolean}
 */
export function isRecording() {
  return Boolean(activeRecorder);
}

/**
 * Записывает аудио с микрофона в указанный файл.
 * @param {string} destWavPath - Путь сохранения WAV файла
 * @param {object} [options]
 * @param {number} [options.maxDurationMs=15000] - Максимальная длительность записи
 * @returns {Promise<boolean>}
 */
export function recordAudio(destWavPath, { maxDurationMs = 15000 } = {}) {
  stopRecording();

  return new Promise((resolve) => {
    let cmd = 'pw-record';
    let args = ['--rate', '16000', '--channels', '1', '--format', 's16', destWavPath];

    if (process.platform === 'darwin') {
      cmd = 'rec';
      args = ['-q', '-r', '16000', '-c', '1', '-b', '16', destWavPath];
    } else if (process.platform === 'win32') {
      cmd = 'ffmpeg';
      args = ['-y', '-f', 'dshow', '-i', 'audio=default', '-ar', '16000', '-ac', '1', destWavPath];
    } else {
      // Linux: если pw-record нет, пробуем arecord
      if (!fs.existsSync('/usr/bin/pw-record') && fs.existsSync('/usr/bin/arecord')) {
        cmd = 'arecord';
        args = ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', destWavPath];
      }
    }

    let timer = null;
    const recorder = spawn(cmd, args, { stdio: 'ignore' });
    activeRecorder = recorder;

    const finish = () => {
      if (timer) clearTimeout(timer);
      activeRecorder = null;
      resolve(fs.existsSync(destWavPath) && fs.statSync(destWavPath).size > 100);
    };

    recorder.on('close', finish);
    recorder.on('error', () => {
      // Если pw-record упал, пробуем arecord
      if (cmd === 'pw-record') {
        const fallback = spawn('arecord', ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', destWavPath], { stdio: 'ignore' });
        activeRecorder = fallback;
        fallback.on('close', finish);
        fallback.on('error', () => {
          activeRecorder = null;
          resolve(false);
        });
      } else {
        activeRecorder = null;
        resolve(false);
      }
    });

    if (maxDurationMs > 0) {
      timer = setTimeout(() => {
        stopRecording();
      }, maxDurationMs);
    }
  });
}

/**
 * Распознает речь из WAV-файла через whisper-cli.
 * @param {string} wavPath - Путь к WAV файлу
 * @returns {Promise<string>}
 */
export async function transcribeAudioFile(wavPath) {
  if (!isVoiceAvailable() || !fs.existsSync(wavPath)) {
    return '';
  }

  const { whisperBin, whisperModel } = getVoicePaths();

  return new Promise((resolve) => {
    const proc = spawn(whisperBin, [
      '-m', whisperModel,
      '-f', wavPath,
      '--language', 'auto',
      '-nt',
      '--no-prints'
    ]);

    let output = '';

    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Убираем системные маркеры Whisper типа [BLANK_AUDIO]
        const cleaned = output
          .replace(/\[BLANK_AUDIO\]/gi, '')
          .replace(/\n+/g, ' ')
          .trim();
        resolve(cleaned);
      } else {
        resolve('');
      }
    });

    proc.on('error', () => {
      resolve('');
    });
  });
}

/**
 * Комплексный запуск: запись голоса и последующая транскрипция.
 * @param {object} [options]
 * @param {number} [options.maxDurationMs=15000]
 * @returns {Promise<string>}
 */
export async function recordAndTranscribe({ maxDurationMs = 15000 } = {}) {
  const tempWav = path.join(os.tmpdir(), `duddy-record-${Date.now()}.wav`);
  try {
    const recorded = await recordAudio(tempWav, { maxDurationMs });
    if (!recorded) return '';
    const text = await transcribeAudioFile(tempWav);
    return text;
  } finally {
    try {
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch {}
  }
}
