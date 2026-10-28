import chalk from 'chalk';

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
 * Terminal renderer with Markdown formatting and instant streaming.
 */
export class AnimatedTerminalRenderer {
  constructor() {
    this.inCodeBlock = false;
    this.lineBuffer = '';
  }

  renderLine(line) {
    // Code block fences
    if (line.trim().startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      const lang = line.trim().slice(3).trim();
      return this.inCodeBlock
        ? chalk.hex('#334155')('── [') + chalk.bold.hex('#38bdf8')(lang || 'code') + chalk.hex('#334155')('] ' + '─'.repeat(Math.max(10, 48 - (lang || 'code').length)))
        : chalk.hex('#334155')('─'.repeat(54));
    }

    if (this.inCodeBlock) {
      // Pure code: clean syntax coloring, no prefix characters so copying is 100% clean
      return chalk.greenBright(line);
    }

    return line
      // Headings
      .replace(/^### (.*$)/gim, (_, p1) => chalk.bold.magenta('  ▸ ' + p1))
      .replace(/^## (.*$)/gim, (_, p1) => chalk.bold.cyan('■ ' + p1))
      .replace(/^# (.*$)/gim, (_, p1) => chalk.bold.yellow('◆ ' + p1))
      // Bold **text**
      .replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold(p1))
      // Italic *text*
      .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, (_, p1) => chalk.italic(p1))
      // Inline code `cmd`
      .replace(/`([^`]+)`/g, (_, p1) => chalk.cyanBright(p1))
      // Bullet lists
      .replace(/^(\s*)[-*]\s+/gm, '$1  • ')
      // Numbered lists
      .replace(/^(\s*)(\d+\.)\s+/gm, (_, p1, p2) => p1 + '  ' + chalk.bold(p2) + ' ');
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
    if (this.inCodeBlock) {
      process.stdout.write(chalk.hex('#334155')('─'.repeat(54)) + '\n');
      this.inCodeBlock = false;
    }
  }
}
