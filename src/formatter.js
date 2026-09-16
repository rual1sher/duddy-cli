import chalk from 'chalk';

/**
 * Creates a streaming line-buffered markdown renderer for terminal output.
 */
export function createTerminalStreamRenderer() {
  let inCodeBlock = false;
  let lineBuffer = '';

  function renderLine(line) {
    // Code block fences
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      const lang = line.trim().slice(3).trim();
      return inCodeBlock
        ? chalk.dim('  ┌─ [') + chalk.yellow(lang || 'code') + chalk.dim('] ' + '─'.repeat(Math.max(10, 40 - (lang || 'code').length)))
        : chalk.dim('  └' + '─'.repeat(45));
    }

    // Inside code block: indent and colorize
    if (inCodeBlock) {
      return chalk.dim('  │ ') + chalk.greenBright(line);
    }

    // Outside code block: format markdown
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

  return {
    push(chunk, onLine) {
      lineBuffer += chunk;
      if (lineBuffer.includes('\n')) {
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? ''; // keep remainder
        for (const line of lines) {
          onLine(renderLine(line) + '\n');
        }
      }
    },
    flush(onLine) {
      if (lineBuffer) {
        onLine(renderLine(lineBuffer) + '\n');
        lineBuffer = '';
      }
      if (inCodeBlock) {
        onLine(chalk.dim('  └' + '─'.repeat(45)) + '\n');
        inCodeBlock = false;
      }
    }
  };
}
