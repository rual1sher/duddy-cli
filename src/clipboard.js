/**
 * @fileoverview Чтение изображений и текста из системного буфера обмена (Wayland / X11)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_IMAGE_BYTES } from './images.js';

const execFileAsync = promisify(execFile);

const SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Читает изображение из буфера обмена операционной системы (Wayland или X11).
 *
 * @returns {Promise<{ mime: string, data: Buffer }|null>}
 */
export async function readClipboardImage() {
  const isWayland = Boolean(process.env.WAYLAND_DISPLAY);
  const missingToolMessage = 'Для вставки картинок установите wl-clipboard (Wayland) или xclip (X11)';

  let targetsRaw = '';
  try {
    if (isWayland) {
      const res = await execFileAsync('wl-paste', ['--list-types'], {
        timeout: 3000,
        maxBuffer: 1024 * 1024
      });
      targetsRaw = String(res.stdout || '');
    } else {
      const res = await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], {
        timeout: 3000,
        maxBuffer: 1024 * 1024
      });
      targetsRaw = String(res.stdout || '');
    }
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      throw new Error(missingToolMessage);
    }
    return null;
  }

  const targetLines = targetsRaw.split(/\r?\n/).map(line => line.trim().toLowerCase());
  const chosenMime = SUPPORTED_MIMES.find(mime =>
    targetLines.some(line => line === mime || line.startsWith(`${mime};`))
  );

  if (!chosenMime) {
    return null;
  }

  let data;
  try {
    const res = isWayland
      ? await execFileAsync('wl-paste', ['--type', chosenMime], {
          timeout: 3000,
          maxBuffer: 20 * 1024 * 1024,
          encoding: 'buffer'
        })
      : await execFileAsync('xclip', ['-selection', 'clipboard', '-t', chosenMime, '-o'], {
          timeout: 3000,
          maxBuffer: 20 * 1024 * 1024,
          encoding: 'buffer'
        });
    data = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      throw new Error(missingToolMessage);
    }
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const limitMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(`Размер изображения превышает лимит ${limitMb} МБ`);
    }
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > MAX_IMAGE_BYTES) {
    const sizeMb = (data.length / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`Размер изображения (${sizeMb} МБ) превышает лимит ${limitMb} МБ`);
  }

  return { mime: chosenMime, data };
}

/**
 * Читает текстовое содержимое буфера обмена операционной системы (Wayland или X11).
 *
 * @returns {Promise<string>}
 */
export async function readClipboardText() {
  const isWayland = Boolean(process.env.WAYLAND_DISPLAY);
  try {
    const res = isWayland
      ? await execFileAsync('wl-paste', ['--no-newline'], { timeout: 3000 })
      : await execFileAsync('xclip', ['-selection', 'clipboard', '-o'], { timeout: 3000 });
    return String(res?.stdout || '');
  } catch {
    return '';
  }
}
