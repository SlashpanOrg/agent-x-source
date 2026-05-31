import { execSync } from 'child_process';

export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text, encoding: 'utf-8' });
      return true;
    }
    if (process.platform === 'linux') {
      execSync('xclip -selection clipboard', { input: text, encoding: 'utf-8' });
      return true;
    }
    if (process.platform === 'win32') {
      execSync('clip', { input: text, encoding: 'utf-8' });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
