import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Sandbox, SandboxResult, SandboxOptions } from '@agentx/shared';

interface BackgroundProcess {
  pid: number;
  command: string;
  proc: ChildProcess;
  started: number;
}

export class NamespaceSandbox implements Sandbox {
  readonly name = 'namespace';
  readonly available = true;
  private processes: Map<number, BackgroundProcess> = new Map();
  private nextPid = 1000;
  private workDir: string;
  private allowedPaths: string[];
  private deniedPaths: string[];
  private tempDirs: Set<string> = new Set();

  constructor(allowedPaths?: string[], deniedPaths?: string[]) {
    this.workDir = join(tmpdir(), 'agentx-ns');
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
    this.allowedPaths = allowedPaths ?? [process.cwd(), this.workDir, tmpdir()];
    this.deniedPaths = deniedPaths ?? [];
  }

  async exec(command: string, options?: SandboxOptions): Promise<SandboxResult> {
    const startTime = Date.now();
    const workDir = options?.cwd
      ? this.resolvePath(options.cwd, options)
      : this.prepareWorkDir();

    return new Promise((resolve) => {
      const timeout = options?.timeout ?? 60_000;
      const cmd = this.buildShellCommand(command, options);

      const proc = spawn(cmd.command, cmd.args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.buildEnv(options),
        timeout,
      } as Record<string, unknown> as Record<string, unknown>);

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve({
          stdout,
          stderr: 'Process timed out',
          exitCode: -1,
          duration: Date.now() - startTime,
          error: 'TIMEOUT',
        });
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: err.message,
          exitCode: -1,
          duration: Date.now() - startTime,
          error: err.message,
        });
      });
    });
  }

  async execBackground(command: string, options?: SandboxOptions): Promise<{ pid: number }> {
    const pid = this.nextPid++;
    const workDir = options?.cwd
      ? this.resolvePath(options.cwd, options)
      : this.prepareWorkDir();

    const { command: cmd, args } = this.buildShellCommand(command, options);

    const proc = spawn(cmd, args, {
      cwd: workDir,
      stdio: 'ignore',
      env: this.buildEnv(options),
      detached: true,
    } as Record<string, unknown> as Record<string, unknown>);

    proc.unref();

    this.processes.set(pid, { pid, command, proc, started: Date.now() });
    return { pid };
  }

  async kill(pid: number): Promise<boolean> {
    const proc = this.processes.get(pid);
    if (!proc) return false;

    try {
      proc.proc.kill('SIGTERM');
      // Wait briefly for graceful shutdown
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try { proc.proc.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 2000);
        proc.proc.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.processes.delete(pid);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<Array<{ pid: number; command: string }>> {
    return [...this.processes.values()].map((p) => ({ pid: p.pid, command: p.command }));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    this.validatePath(fullPath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content, 'utf-8');
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    this.validatePath(fullPath);
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(fullPath, 'utf-8');
  }

  async dispose(): Promise<void> {
    for (const pid of this.processes.keys()) {
      await this.kill(pid);
    }
    for (const dir of this.tempDirs) {
      try {
        execSync(`rm -rf ${dir}`, { timeout: 10_000 });
      } catch {
        // Best-effort
      }
    }
    this.tempDirs.clear();
  }

  private prepareWorkDir(): string {
    const dir = join(this.workDir, randomBytes(4).toString('hex'));
    mkdirSync(dir, { recursive: true });
    this.tempDirs.add(dir);
    return dir;
  }

  private resolvePath(path: string, options?: SandboxOptions): string {
    if (path.startsWith('/')) return path;
    const base = options?.cwd ?? process.cwd();
    return resolve(base, path);
  }

  private validatePath(fullPath: string): void {
    const real = resolve(normalize(fullPath));

    for (const denied of this.deniedPaths) {
      const deniedReal = resolve(normalize(denied));
      if (real.startsWith(deniedReal)) {
        throw new Error(`Access denied: ${fullPath} is in a restricted path`);
      }
    }

    if (this.allowedPaths.length > 0) {
      const allowed = this.allowedPaths.some((p) => {
        const allowedReal = resolve(normalize(p));
        return real.startsWith(allowedReal);
      });
      if (!allowed) {
        throw new Error(`Access denied: ${fullPath} is not in an allowed path`);
      }
    }
  }

  private buildShellCommand(
    command: string,
    _options?: SandboxOptions,
  ): { command: string; args: string[] } {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellArg = process.platform === 'win32' ? '/c' : '-c';
    return { command: shell, args: [shellArg, command] };
  }

  private buildEnv(options?: SandboxOptions): Record<string, string | undefined> {
    const base: Record<string, string | undefined> = {
      ...process.env,
      ...options?.env,
      AGENTX_SANDBOX: '1',
    };

    // Restrict dangerous variables
    if (options?.networkAccess === false) {
      delete base['HTTP_PROXY'];
      delete base['HTTPS_PROXY'];
      delete base['http_proxy'];
      delete base['https_proxy'];
    }

    return base;
  }
}
