/**
 * @fileoverview Форматирование вывода в терминале (длительность, Markdown, код)
 */

import chalk from 'chalk';
import { paint } from './theme.js';

/**
 * Форматирует миллисекунды в читаемую строку длительности:
 * < 60 000 мс → Xs (например, 4.2s)
 * >= 60 000 мс → Xm Ys (например, 1m 05s)
 *
 * @param {number} ms - Время в миллисекундах
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  let mins = Math.floor(ms / 60000);
  let secsNum = Math.round((ms % 60000) / 1000);
  if (secsNum === 60) {
    mins += 1;
    secsNum = 0;
  }
  const secs = String(secsNum).padStart(2, '0');
  return `${mins}m ${secs}s`;
}

/**
 * Рендерит одну строку Markdown с учётом состояния блока кода.
 *
 * @param {string} line - Строка для рендера
 * @param {{ inCodeBlock: boolean }} state - Состояние парсера блока кода
 * @returns {string}
 */
export function renderLine(line, state = { inCodeBlock: false }) {
  // Code block fences
  if (line.trim().startsWith('```')) {
    state.inCodeBlock = !state.inCodeBlock;
    const lang = line.trim().slice(3).trim();
    return state.inCodeBlock
      ? paint('border')('── [') + paint('accent').bold(lang || 'code') + paint('border')('] ' + '─'.repeat(Math.max(10, 48 - (lang || 'code').length)))
      : paint('border')('─'.repeat(54));
  }

  if (state.inCodeBlock) {
    // Pure code: clean syntax coloring, no prefix characters so copying is 100% clean
    return paint('success')(line);
  }

  return line
    // Headings
    .replace(/^### (.*$)/gim, (_, p1) => paint('accent').bold('  ▸ ' + p1))
    .replace(/^## (.*$)/gim, (_, p1) => paint('accent').bold('■ ' + p1))
    .replace(/^# (.*$)/gim, (_, p1) => paint('warning').bold('◆ ' + p1))
    // Bold **text**
    .replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold(p1))
    // Italic *text*
    .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, (_, p1) => chalk.italic(p1))
    // Inline code `cmd`
    .replace(/`([^`]+)`/g, (_, p1) => paint('accent')(p1))
    // Bullet lists
    .replace(/^(\s*)[-*]\s+/gm, '$1  • ')
    // Numbered lists
    .replace(/^(\s*)(\d+\.)\s+/gm, (_, p1, p2) => p1 + '  ' + chalk.bold(p2) + ' ');
}

/**
 * Рендерит многострочный Markdown в массив отформатированных строк для терминала.
 *
 * @param {string} text - Текст Markdown
 * @returns {string[]} Массив отформатированных строк
 */
export function renderMarkdown(text) {
  if (!text) return [];
  const state = { inCodeBlock: false };
  const lines = text.split('\n');
  const result = lines.map(line => renderLine(line, state));
  if (state.inCodeBlock) {
    result.push(paint('border')('─'.repeat(54)));
  }
  return result;
}

/**
 * Потоковый терминальный рендерер с поддержкой Markdown и блоков кода.
 */
export class AnimatedTerminalRenderer {
  constructor() {
    this.state = { inCodeBlock: false };
    this.lineBuffer = '';
  }

  get inCodeBlock() {
    return this.state.inCodeBlock;
  }

  set inCodeBlock(val) {
    this.state.inCodeBlock = val;
  }

  renderLine(line) {
    return renderLine(line, this.state);
  }

  push(chunk) {
    this.lineBuffer += chunk;
    if (this.lineBuffer.includes('\n')) {
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        process.stdout.write(this.renderLine(line) + '\n');
      }
    }
  }

  async flush() {
    if (this.lineBuffer) {
      process.stdout.write(this.renderLine(this.lineBuffer) + '\n');
      this.lineBuffer = '';
    }
    if (this.state.inCodeBlock) {
      process.stdout.write(paint('border')('─'.repeat(54)) + '\n');
      this.state.inCodeBlock = false;
    }
  }
}

/**
 * Форматирует расход токенов за весь ход: вход всех шагов, выход и попадания в кэш
 *
 * @param {{ input: number, output: number, cached: number }} [usage] - Токены хода
 * @returns {string} Строка вида "↑ 12.3k ↓ 800 · кэш 9.0k" или пустая
 */
export function formatTurnUsage(usage) {
  if (!usage?.input) return '';
  const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const cached = usage.cached ? ` · кэш ${short(usage.cached)}` : '';
  return `↑ ${short(usage.input)} ↓ ${short(usage.output)}${cached}`;
}
