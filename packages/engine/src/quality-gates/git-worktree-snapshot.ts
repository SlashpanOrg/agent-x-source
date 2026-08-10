import { createHash } from 'node:crypto';
import { capGitOutput, runGitCommand } from './git-exec.js';

export function gitWorktreeSnapshot(cwd: string): { hash: string; status: string; diff: string } {
  let status = '';
  let diff = '';
  try {
    status = runGitCommand('git status --porcelain', cwd, 15_000);
    diff = runGitCommand('git diff HEAD', cwd, 30_000);
  } catch {
    status = '';
    diff = '';
  }
  const hash = createHash('sha256').update(status).update('\n').update(diff).digest('hex');
  return { hash, status: capGitOutput(status), diff: capGitOutput(diff) };
}
