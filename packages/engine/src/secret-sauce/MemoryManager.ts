import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  timestamp: string;
  relevance: number;
}

/** Categories that are global (shared across all profiles) */
const GLOBAL_CATEGORIES = new Set(['identity', 'preference']);

export class MemoryManager {
  private globalMemories: MemoryEntry[] = [];
  private profileMemories: MemoryEntry[] = [];
  private secretSauceDir: string;
  private profileId: string;
  private maxMemories = 100;
  private windowDays = 30;

  constructor(profileId = 'default') {
    this.secretSauceDir = getSecretSauceDir();
    this.profileId = profileId;
    this.loadGlobal();
    this.loadProfile();
  }

  private getGlobalPath(): string {
    return join(this.secretSauceDir, 'global', 'memories.json');
  }

  private getProfilePath(): string {
    return join(this.secretSauceDir, 'profiles', this.profileId, 'memories.json');
  }

  private loadGlobal(): void {
    const memPath = this.getGlobalPath();
    if (existsSync(memPath)) {
      try {
        this.globalMemories = JSON.parse(readFileSync(memPath, 'utf-8')) as MemoryEntry[];
      } catch {
        this.globalMemories = [];
      }
    }
  }

  private loadProfile(): void {
    const memPath = this.getProfilePath();
    if (existsSync(memPath)) {
      try {
        this.profileMemories = JSON.parse(readFileSync(memPath, 'utf-8')) as MemoryEntry[];
      } catch {
        this.profileMemories = [];
      }
    }
  }

  private saveGlobal(): void {
    const dir = join(this.secretSauceDir, 'global');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.getGlobalPath(), JSON.stringify(this.globalMemories, null, 2));
  }

  private saveProfile(): void {
    const dir = join(this.secretSauceDir, 'profiles', this.profileId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.getProfilePath(), JSON.stringify(this.profileMemories, null, 2));
  }

  addMemory(content: string, category: string): void {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      category,
      timestamp: new Date().toISOString(),
      relevance: 1.0,
    };

    if (GLOBAL_CATEGORIES.has(category)) {
      this.globalMemories.push(entry);
      this.pruneList(this.globalMemories);
      this.saveGlobal();
    } else {
      this.profileMemories.push(entry);
      this.pruneList(this.profileMemories);
      this.saveProfile();
    }
  }

  private pruneList(list: MemoryEntry[]): MemoryEntry[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.windowDays);
    const cutoffStr = cutoff.toISOString();

    const pruned = list
      .filter((m) => m.timestamp >= cutoffStr)
      .slice(-this.maxMemories);

    list.length = 0;
    list.push(...pruned);
    return list;
  }

  getRecentMemories(limit = 20): MemoryEntry[] {
    return [...this.globalMemories, ...this.profileMemories]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getGlobalMemories(limit = 10): MemoryEntry[] {
    return this.globalMemories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getProfileMemories(limit = 10): MemoryEntry[] {
    return this.profileMemories
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  searchMemories(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return [...this.globalMemories, ...this.profileMemories].filter(
      (m) => m.content.toLowerCase().includes(lower) || m.category.toLowerCase().includes(lower),
    );
  }

  /**
   * Build context for system prompt.
   * Global memories = user identity/preferences (shared).
   * Profile memories = domain-specific knowledge for this profile.
   */
  buildContext(tokenBudget = 2000): { global: string; profile: string } {
    const globalCtx = this.buildSection(this.getGlobalMemories(10), 'USER_CONTEXT', Math.floor(tokenBudget * 0.4));
    const profileCtx = this.buildSection(this.getProfileMemories(10), 'PROFILE_MEMORIES', Math.floor(tokenBudget * 0.6));
    return { global: globalCtx, profile: profileCtx };
  }

  private buildSection(entries: MemoryEntry[], tag: string, budget: number): string {
    if (entries.length === 0) return '';

    let context = `[${tag}]\n`;
    let estimated = 20;

    for (const mem of entries) {
      const line = `- [${mem.category}] ${mem.content}\n`;
      const lineTokens = Math.ceil(line.length / 4);
      if (estimated + lineTokens > budget) break;
      context += line;
      estimated += lineTokens;
    }

    context += `[/${tag}]`;
    return context;
  }

  getCount(): number {
    return this.globalMemories.length + this.profileMemories.length;
  }

  /**
   * Migrate legacy flat memories.json into the new structure.
   */
  static migrateIfNeeded(profileId: string): void {
    const sauceDir = getSecretSauceDir();
    const legacyPath = join(sauceDir, 'memories.json');
    if (!existsSync(legacyPath)) return;

    try {
      const entries = JSON.parse(readFileSync(legacyPath, 'utf-8')) as MemoryEntry[];
      const globalDir = join(sauceDir, 'global');
      const profileDir = join(sauceDir, 'profiles', profileId);
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(profileDir, { recursive: true });

      const globalEntries = entries.filter((m) => GLOBAL_CATEGORIES.has(m.category));
      const profileEntries = entries.filter((m) => !GLOBAL_CATEGORIES.has(m.category));

      writeFileSync(join(globalDir, 'memories.json'), JSON.stringify(globalEntries, null, 2));
      writeFileSync(join(profileDir, 'memories.json'), JSON.stringify(profileEntries, null, 2));

      // Remove legacy file after successful migration
      unlinkSync(legacyPath);
    } catch {
      // Migration is best-effort
    }
  }
}
