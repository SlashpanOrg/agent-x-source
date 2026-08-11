import { resolve } from 'node:path';
import { getCompactionFileTracker } from './CompactionFileTrackerAccess.js';

const FILE_PATH_RE = /(?:^|[\s'"=])([\w./~-]+(?:\.[a-zA-Z0-9]{1,8})+)/g;

function normalizePath(scopePath: string, raw: string): string {
  const trimmed = raw.replace(/^['"]|['"]$/g, '');
  if (!trimmed || trimmed.startsWith('http')) return '';
  try {
    return resolve(scopePath, trimmed);
  } catch {
    return '';
  }
}

export function recordCompactionRead(sessionId: string, scopePath: string, path: string): void {
  const tracker = getCompactionFileTracker(sessionId);
  if (!tracker || !path) return;
  tracker.recordRead(normalizePath(scopePath, path));
}

export function recordCompactionModified(sessionId: string, scopePath: string, path: string): void {
  const tracker = getCompactionFileTracker(sessionId);
  if (!tracker || !path) return;
  tracker.recordModified(normalizePath(scopePath, path));
}

export function recordCompactionFromShell(sessionId: string, scopePath: string, command: string, cwd?: string): void {
  const tracker = getCompactionFileTracker(sessionId);
  if (!tracker || !command) return;
  const base = cwd ? resolve(scopePath, cwd) : scopePath;
  if (/>>?|tee |sed -i|mv |cp |touch |npm |pnpm |yarn |cargo |go build|make /.test(command)) {
    tracker.recordModified(base);
  }
  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_PATH_RE.source, 'g');
  while ((m = re.exec(command)) !== null) {
    const p = normalizePath(base, m[1]!);
    if (p) {
      if (/>>?|tee |sed -i|mv |cp |touch /.test(command.slice(Math.max(0, m.index - 8), m.index + m[0].length))) {
        tracker.recordModified(p);
      } else {
        tracker.recordRead(p);
      }
    }
  }
}
