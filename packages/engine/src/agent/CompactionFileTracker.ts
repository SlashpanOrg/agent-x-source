import type { CompactionFileSet } from '@agentx/shared';

/** Tracks workspace files read/modified for compaction artifacts. */
export class CompactionFileTracker {
  private filesRead = new Set<string>();
  private filesModified = new Set<string>();

  recordRead(path: string): void {
    if (path) this.filesRead.add(path);
  }

  recordModified(path: string): void {
    if (path) this.filesModified.add(path);
  }

  snapshot(): CompactionFileSet {
    return {
      filesRead: [...this.filesRead].sort(),
      filesModified: [...this.filesModified].sort(),
    };
  }

  clear(): void {
    this.filesRead.clear();
    this.filesModified.clear();
  }

  restore(fileSet: CompactionFileSet): void {
    this.clear();
    for (const p of fileSet.filesRead) this.filesRead.add(p);
    for (const p of fileSet.filesModified) this.filesModified.add(p);
  }
}
