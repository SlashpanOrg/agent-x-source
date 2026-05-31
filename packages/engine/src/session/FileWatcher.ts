import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';

export type WatchEvent = 'change' | 'add' | 'unlink';
export type WatchCallback = (event: WatchEvent, filePath: string) => void;

export interface WatchEntry {
  pattern: string;
  command: string;
  cwd: string;
}

export class FileWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map();
  private entries: WatchEntry[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number;

  get watcherCount(): number {
    return this.entries.length;
  }

  constructor(debounceMs = 500) {
    super();
    this.debounceMs = debounceMs;
  }

  addWatch(pattern: string, command: string, cwd: string = process.cwd()): boolean {
    this.entries.push({ pattern, command, cwd });
    const absCwd = resolve(cwd);
    if (!this.watchers.has(absCwd)) {
      try {
        const watcher = watch(absCwd, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const filePath = resolve(absCwd, filename);
          if (!this.matchesPattern(filePath, pattern)) return;
          this.debounce(filename, () => {
            this.emit('file_changed', eventType as WatchEvent, filePath, command);
          });
        });
        this.watchers.set(absCwd, watcher);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  removeWatch(pattern: string): void {
    const idx = this.entries.findIndex((e) => e.pattern === pattern);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }
  }

  removeAllWatches(): void {
    this.entries = [];
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  getEntries(): WatchEntry[] {
    return [...this.entries];
  }

  isWatching(): boolean {
    return this.entries.length > 0;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    if (pattern === '*') return true;
    const simplePatterns = ['test', 'lint', 'build'];
    if (simplePatterns.includes(pattern)) {
      return true;
    }
    if (pattern.startsWith('*.')) {
      return filePath.endsWith(pattern.slice(1));
    }
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(filePath);
    }
    return filePath.includes(pattern);
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, this.debounceMs));
  }

  close(): void {
    this.removeAllWatches();
  }
}
