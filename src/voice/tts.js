/**
 * @fileoverview Локальный синтез речи (TTS) на базе Piper
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getVoicePaths, isVoiceAvailable } from './paths.js';
import { cleanTextForSpeech } from './cleanText.js';

let activePlayer = null;
let activePiper = null;

/**
 * Останавливает текущее воспроизведение речи.
 */
export function stopSpeech() {
  if (activePlayer) {
    try {
      activePlayer.kill('SIGTERM');
    } catch {}
    activePlayer = null;
  }
  if (activePiper) {
    try {
      activePiper.kill('SIGTERM');
    } catch {}
    activePiper = null;
  }
}

/**
 * Проверяет, проигрывается ли сейчас речь.
 * @returns {boolean}
 */
export function isSpeaking() {
  return Boolean(activePlayer || activePiper);
}

/**
 * Озвучивает текст с помощью Piper TTS.
 * @param {string} rawText - Текст для озвучки
 * @returns {Promise<boolean>}
 */
export async function speak(rawText) {
  stopSpeech();

  if (!isVoiceAvailable()) {
    return false;
  }

  const text = cleanTextForSpeech(rawText);
  if (!text) return false;

  const { piperBin, piperModel } = getVoicePaths();
  const tempWav = path.join(os.tmpdir(), `duddy-speech-${Date.now()}.wav`);

  return new Promise((resolve) => {
    // 1. Генерация WAV через Piper
    const piper = spawn(piperBin, [
      '--model', piperModel,
      '--output_file', tempWav
    ]);
    activePiper = piper;

    piper.stdin.write(text);
    piper.stdin.end();

    piper.on('error', () => {
      activePiper = null;
      cleanup(tempWav);
      resolve(false);
    });

    piper.on('close', (code) => {
      activePiper = null;
      if (code !== 0 || !fs.existsSync(tempWav)) {
        cleanup(tempWav);
        resolve(false);
        return;
      }

      // 2. Воспроизведение
      playAudioFile(tempWav)
        .then(() => {
          cleanup(tempWav);
          resolve(true);
        })
        .catch(() => {
          cleanup(tempWav);
          resolve(false);
        });
    });
  });
}

function playAudioFile(wavPath) {
  return new Promise((resolve, reject) => {
    let cmd = 'pw-play';
    let args = [wavPath];

    if (process.platform === 'darwin') {
      cmd = 'afplay';
      args = [wavPath];
    } else if (process.platform === 'win32') {
      cmd = 'powershell';
      args = ['-c', `(New-Object Media.SoundPlayer '${wavPath}').PlaySync()`];
    } else {
      // Linux: пробуем pw-play, если нет - aplay
      if (!fs.existsSync('/usr/bin/pw-play') && fs.existsSync('/usr/bin/aplay')) {
        cmd = 'aplay';
        args = ['-q', wavPath];
      }
    }

    const player = spawn(cmd, args, { stdio: 'ignore' });
    activePlayer = player;

    player.on('close', () => {
      activePlayer = null;
      resolve();
    });

    player.on('error', (err) => {
      activePlayer = null;
      // Если pw-play не сработал на Linux, пробуем aplay
      if (cmd === 'pw-play') {
        const fallback = spawn('aplay', ['-q', wavPath], { stdio: 'ignore' });
        activePlayer = fallback;
        fallback.on('close', () => {
          activePlayer = null;
          resolve();
        });
        fallback.on('error', reject);
      } else {
        reject(err);
      }
    });
  });
}

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}
