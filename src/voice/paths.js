import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'duddy');
export const VOICE_DIR = path.join(CONFIG_DIR, 'voice');
export const MODELS_DIR = path.join(VOICE_DIR, 'models');
export const PIPER_DIR = path.join(VOICE_DIR, 'piper');
export const WHISPER_DIR = path.join(VOICE_DIR, 'whisper');

export function getVoicePaths() {
  const isWin = process.platform === 'win32';
  
  const piperBin = path.join(PIPER_DIR, isWin ? 'piper.exe' : 'piper');
  const whisperBin = path.join(WHISPER_DIR, isWin ? 'whisper-cli.exe' : 'whisper-cli');
  const piperModel = path.join(MODELS_DIR, 'ru_RU-dmitri-medium.onnx');
  const piperConfig = path.join(MODELS_DIR, 'ru_RU-dmitri-medium.onnx.json');
  const whisperModel = path.join(MODELS_DIR, 'ggml-base.bin');

  return {
    voiceDir: VOICE_DIR,
    piperDir: PIPER_DIR,
    whisperDir: WHISPER_DIR,
    modelsDir: MODELS_DIR,
    piperBin,
    whisperBin,
    piperModel,
    piperConfig,
    whisperModel
  };
}

export function isVoiceAvailable() {
  const p = getVoicePaths();
  return (
    fs.existsSync(p.piperBin) &&
    fs.existsSync(p.whisperBin) &&
    fs.existsSync(p.piperModel) &&
    fs.existsSync(p.piperConfig) &&
    fs.existsSync(p.whisperModel)
  );
}

export function getVoiceStatus() {
  const p = getVoicePaths();
  return {
    available: isVoiceAvailable(),
    piper: fs.existsSync(p.piperBin),
    whisper: fs.existsSync(p.whisperBin),
    piperModel: fs.existsSync(p.piperModel),
    piperConfig: fs.existsSync(p.piperConfig),
    whisperModel: fs.existsSync(p.whisperModel),
    paths: p
  };
}
