import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface GitManagerOptions {
  scopePath?: string;
  branchPrefix?: string;
}

export class GitManager {
  private scopePath: string;
  private branchPrefix: string;
  private repoRoot: string | null = null;
  private trackedFilesCache: string[] | null = null;

  constructor(options: GitManagerOptions = {}) {
    this.scopePath = options.scopePath ?? process.cwd();
    this.branchPrefix = options.branchPrefix ?? 'session/';
    this.repoRoot = this.findRepoRoot();
  }

  isInsideRepo(): boolean {
    return this.repoRoot !== null;
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  isPathInsideRepo(absolutePath: string): boolean {
    if (!this.repoRoot) return false;
    return resolve(absolutePath).startsWith(this.repoRoot + '/') || resolve(absolutePath) === this.repoRoot;
  }

  getTrackedFiles(forceRefresh = false): string[] {
    if (this.trackedFilesCache && !forceRefresh) return this.trackedFilesCache;
    if (!this.repoRoot) return [];
    try {
      const output = execSync('git ls-files', {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      this.trackedFilesCache = output.trim().split('\n').filter(Boolean);
      return this.trackedFilesCache;
    } catch {
      this.trackedFilesCache = [];
      return [];
    }
  }

  getUntrackedFiles(): string[] {
    if (!this.repoRoot) return [];
    try {
      const output = execSync('git ls-files --others --exclude-standard', {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  ensureBranch(): boolean {
    if (!this.repoRoot) return false;
    const branchName = this.getBranchName();
    try {
      execSync(`git checkout -b "${branchName}" 2>/dev/null || git checkout "${branchName}"`, {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  commitSessionExport(sessionId: string, messages: unknown[], message: string): boolean {
    if (!this.repoRoot) return false;
    try {
      this.ensureBranch();
      const sessionDir = join(this.repoRoot, '.agentx', 'sessions');
      mkdirSync(sessionDir, { recursive: true });
      const filePath = join(sessionDir, `${sessionId}.json`);
      writeFileSync(filePath, JSON.stringify({ sessionId, messages, exportedAt: new Date().toISOString() }, null, 2), 'utf-8');
      execSync(`git add "${filePath}"`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 });
      execSync(`git commit -m "session(${sessionId.slice(0, 8)}): ${message}" --allow-empty`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  commitAfterEdit(filePath: string, sessionId?: string): boolean {
    if (!this.repoRoot) return false;
    try {
      this.ensureBranch();
      const rel = resolve(filePath).startsWith(this.repoRoot)
        ? resolve(filePath).slice(this.repoRoot.length + 1)
        : filePath;
      execSync(`git add "${resolve(filePath)}"`, { cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000 });
      const tag = sessionId ? `session(${sessionId.slice(0, 8)})` : 'auto';
      execSync(`git commit -m "${tag}: auto-commit ${rel}" --allow-empty`, {
        cwd: this.repoRoot, encoding: 'utf-8', timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  getBranchName(sessionId?: string): string {
    return sessionId ? `${this.branchPrefix}${sessionId.slice(0, 8)}` : `${this.branchPrefix}auto`;
  }

  private findRepoRoot(): string | null {
    try {
      const output = execSync('git rev-parse --show-toplevel 2>/dev/null', {
        cwd: this.scopePath,
        encoding: 'utf-8',
        timeout: 5000,
      });
      const root = output.trim();
      return root || null;
    } catch {
      return null;
    }
  }
}
