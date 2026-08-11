import { execSync } from 'node:child_process';

const OUTPUT_CAP = 6000;

export function capGitOutput(s: string): string {
  return s.length > OUTPUT_CAP ? s.slice(0, OUTPUT_CAP) + '\n...[truncated]' : s;
}

/** Shared git subprocess helper (quality gates + task executor). */
export function runGitCommand(command: string, cwd: string, timeoutMs = 30_000): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    shell: '/bin/bash',
  });
}
