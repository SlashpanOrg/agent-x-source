import type { CompactionFileTracker } from './CompactionFileTracker.js';

const bySession = new Map<string, CompactionFileTracker>();

export function registerCompactionFileTracker(sessionId: string, tracker: CompactionFileTracker): void {
  bySession.set(sessionId, tracker);
}

export function unregisterCompactionFileTracker(sessionId: string): void {
  bySession.delete(sessionId);
}

export function getCompactionFileTracker(sessionId: string): CompactionFileTracker | undefined {
  return bySession.get(sessionId);
}
