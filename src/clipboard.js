import { execSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Copies text to system clipboard (Wayland wl-copy or X11 xclip).
 */
export function copyToClipboard(text) {
  try {
    execSync('wl-copy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch (e) {
    try {
      execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * Extracts raw code blocks from markdown text.
 */
export function extractCodeBlocks(markdown) {
  const codeBlocks = [];
  const regex = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    codeBlocks.push(match[1].trim());
  }
  return codeBlocks;
}

/**
 * Saves code block to a local file.
 */
export function saveCodeToFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}
