import { createHash } from 'node:crypto';

interface CacheEntry {
  result: string;
  resourceUsage: {
    cpuTime?: number;
    memoryPeak?: number;
    tokenUsage?: { input: number; output: number };
  };
  cachedAt: number;
  expiresAt: number;
}

export class SubAgentCache {
  private store = new Map<string, CacheEntry>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 300_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  deriveKey(instruction: string, tools: string[], systemPromptHash: string): string {
    const hash = createHash('sha256');
    hash.update(instruction);
    hash.update(tools.sort().join(','));
    hash.update(systemPromptHash);
    return hash.digest('hex');
  }

  get(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set(
    key: string,
    result: string,
    resourceUsage: CacheEntry['resourceUsage'],
    ttlMs?: number
  ): void {
    const now = Date.now();
    this.store.set(key, {
      result,
      resourceUsage,
      cachedAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}