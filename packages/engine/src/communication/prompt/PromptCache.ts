export interface CacheEntry {
  sessionId: string;
  stableHash: string;
  stablePrefix: string;
  createdAt: number;
  lastHitAt: number;
  hitCount: number;
}

export class PromptCache {
  private cache = new Map<string, CacheEntry>();
  private storeCacheFn:
    | ((sessionId: string, entry: CacheEntry) => Promise<void>)
    | null = null;
  private loadCacheFn:
    | ((sessionId: string) => Promise<CacheEntry | null>)
    | null = null;

  setStoreFn(fn: (sessionId: string, entry: CacheEntry) => Promise<void>): void {
    this.storeCacheFn = fn;
  }

  setLoadFn(fn: (sessionId: string) => Promise<CacheEntry | null>): void {
    this.loadCacheFn = fn;
  }

  lookup(sessionId: string, hash: string): CacheEntry | null {
    const entry = this.cache.get(sessionId);

    if (entry && entry.stableHash === hash) {
      entry.lastHitAt = Date.now();
      entry.hitCount++;
      return entry;
    }

    return null;
  }

  store(sessionId: string, hash: string, prefix: string): void {
    const entry: CacheEntry = {
      sessionId,
      stableHash: hash,
      stablePrefix: prefix,
      createdAt: Date.now(),
      lastHitAt: Date.now(),
      hitCount: 0,
    };

    this.cache.set(sessionId, entry);
  }

  async persist(sessionId: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (!entry || !this.storeCacheFn) return;

    await this.storeCacheFn(sessionId, entry);
  }

  async restore(sessionId: string): Promise<CacheEntry | null> {
    if (!this.loadCacheFn) return null;

    const entry = await this.loadCacheFn(sessionId);
    if (entry) {
      this.cache.set(sessionId, entry);
    }

    return entry;
  }

  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  getHitRate(sessionId: string): number {
    const entry = this.cache.get(sessionId);
    if (!entry) return 0;

    const totalTurns = this.cache.size;
    return totalTurns > 0 ? entry.hitCount / totalTurns : 0;
  }

  get stats(): { entries: number } {
    return { entries: this.cache.size };
  }
}
