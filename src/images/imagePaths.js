/**
 * @fileoverview Извлечение и валидация путей к изображениям из текста
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IMAGE_MIME } from './images.js';

/**
 * Разбивает строку на токены с поддержкой кавычек и экранированных пробелов.
 *
 * @param {string} rawText
 * @returns {string[]|null}
 */
export function extractPathTokens(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return null;
  }

  const tokens = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let hasToken = false;

  for (let i = 0; i < rawText.length; i++) {
    const char = rawText[i];

    if (escaped) {
      current += char;
      escaped = false;
      hasToken = true;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      hasToken = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      hasToken = true;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (inSingleQuote || inDoubleQuote || escaped) {
    return null;
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : null;
}

/**
 * Проверяет, состоит ли переданный текст целиком из путей к существующим файлам-картинкам.
 *
 * @param {string} text - Вставленный текст
 * @returns {string[]|null} Массив абсолютных путей к файлам или null
 */
export function parseImagePaths(text) {
  const tokens = extractPathTokens(text);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const absolutePaths = [];

  for (const token of tokens) {
    let clean = token;

    if (clean.startsWith('file://')) {
      try {
        const parsed = new URL(clean);
        clean = decodeURIComponent(parsed.pathname);
      } catch {
        clean = decodeURIComponent(clean.replace(/^file:\/\/(localhost)?/, ''));
      }
    }

    if (clean === '~' || clean.startsWith('~/')) {
      clean = path.join(os.homedir(), clean.slice(1));
    }

    const resolved = path.resolve(clean);
    const ext = path.extname(resolved).toLowerCase();

    if (!IMAGE_MIME[ext]) {
      return null;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return null;
      }
    } catch {
      return null;
    }

    absolutePaths.push(resolved);
  }

  return absolutePaths;
}
