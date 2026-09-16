import chalk from 'chalk';

/**
 * Animated terminal renderer with Markdown formatting and smooth typewriter typing.
 */
export class AnimatedTerminalRenderer {
  constructor() {
    this.inCodeBlock = false;
    this.lineBuffer = '';
    this.queue = [];
    this.running = false;
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
      // Pure code: NO '│' or prefix characters so copying is 100% clean
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
        this.enqueue(this.renderLine(line) + '\n');
      }
    }
  }

  enqueue(text) {
    this.queue.push(...text);
    if (!this.running) {
      this.process();
    }
  }

  async process() {
    this.running = true;
    while (this.queue.length > 0) {
      const char = this.queue.shift();
      process.stdout.write(char);
      // Adaptive delay: typing feel when buffer is small, instant when buffer is backed up
      const delay = this.queue.length > 30 ? 0 : 7;
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    this.running = false;
  }

  async flush() {
    if (this.lineBuffer) {
      this.enqueue(this.renderLine(this.lineBuffer) + '\n');
      this.lineBuffer = '';
    }
    if (this.inCodeBlock) {
      this.enqueue(chalk.hex('#334155')('─'.repeat(54)) + '\n');
      this.inCodeBlock = false;
    }
    while (this.running || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 10));
    }
  }
}
