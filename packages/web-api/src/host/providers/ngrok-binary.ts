/**
 * Resolve or auto-install the official ngrok agent binary into Agent-X data dir.
 *
 * Users should not need Homebrew/apt — on first tunnel enable we download the
 * stable agent from ngrok's CDN (bin.equinox.io / bin.ngrok.com) into
 * `{dataDir}/bin/ngrok` and spawn that path only.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, createWriteStream, existsSync } from 'node:fs';
import { access, chmod, mkdir, rename, rm } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getDataDir, getLogger } from '@agentx/shared';

/** Official stable CDN prefix used by ngrok / pyngrok (Equinox, owned by ngrok). */
const NGROK_CDN_PREFIX = 'https://bin.equinox.io/c/bNyj1mQVY4c/';
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type NgrokArchiveKind = 'zip' | 'tgz';

export interface NgrokDownloadSpec {
  url: string;
  archiveKind: NgrokArchiveKind;
  binaryName: string;
}

let installInFlight: Promise<string> | null = null;

export function getManagedNgrokBinaryPath(): string {
  const name = platform() === 'win32' ? 'ngrok.exe' : 'ngrok';
  return join(getDataDir(), 'bin', name);
}

export function isNgrokAutoInstallEnabled(): boolean {
  const raw = process.env['AGENTX_NGROK_AUTO_INSTALL']?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return true;
}

/** Map Node platform/arch → official stable archive (same mapping as pyngrok). */
export function getNgrokDownloadSpec(
  plat: NodeJS.Platform = platform(),
  cpu: string = arch(),
): NgrokDownloadSpec | null {
  const binaryName = plat === 'win32' ? 'ngrok.exe' : 'ngrok';
  const key = `${plat}-${normalizeArch(cpu)}`;
  const table: Record<string, { file: string; kind: NgrokArchiveKind }> = {
    'darwin-arm64': { file: 'ngrok-v3-stable-darwin-arm64.zip', kind: 'zip' },
    'darwin-x64': { file: 'ngrok-v3-stable-darwin-amd64.zip', kind: 'zip' },
    'linux-arm64': { file: 'ngrok-v3-stable-linux-arm64.tgz', kind: 'tgz' },
    'linux-x64': { file: 'ngrok-v3-stable-linux-amd64.tgz', kind: 'tgz' },
    'linux-arm': { file: 'ngrok-v3-stable-linux-arm.tgz', kind: 'tgz' },
    'linux-ia32': { file: 'ngrok-v3-stable-linux-386.tgz', kind: 'tgz' },
    'win32-x64': { file: 'ngrok-v3-stable-windows-amd64.zip', kind: 'zip' },
    'win32-arm64': { file: 'ngrok-v3-stable-windows-arm64.zip', kind: 'zip' },
    'win32-ia32': { file: 'ngrok-v3-stable-windows-386.zip', kind: 'zip' },
  };
  const entry = table[key];
  if (!entry) return null;
  return {
    url: `${NGROK_CDN_PREFIX}${entry.file}`,
    archiveKind: entry.kind,
    binaryName,
  };
}

function normalizeArch(cpu: string): string {
  if (cpu === 'aarch64') return 'arm64';
  if (cpu === 'x86_64') return 'x64';
  if (cpu === 'i686' || cpu === 'i386') return 'ia32';
  return cpu;
}

function pathIsExecutable(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    if (process.platform === 'win32') return true;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return an existing system/managed ngrok binary, or download one into the
 * Agent-X data directory. Never installs into system PATH (no sudo).
 */
export async function ensureNgrokBinary(options?: {
  preferExisting?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const existing = options?.preferExisting;
  if (existing && pathIsExecutable(existing)) return existing;

  const managed = getManagedNgrokBinaryPath();
  if (pathIsExecutable(managed)) return managed;

  if (!isNgrokAutoInstallEnabled()) {
    throw new Error(
      'ngrok binary not found and auto-install is disabled (AGENTX_NGROK_AUTO_INSTALL=0). ' +
        'Install ngrok or set AGENTX_NGROK_BIN to an absolute path.',
    );
  }

  if (!installInFlight) {
    installInFlight = downloadAndInstallNgrok({
      fetchImpl: options?.fetchImpl,
      targetPath: managed,
    }).finally(() => {
      installInFlight = null;
    });
  }
  return installInFlight;
}

async function downloadAndInstallNgrok(input: {
  fetchImpl?: typeof fetch;
  targetPath: string;
}): Promise<string> {
  const spec = getNgrokDownloadSpec();
  if (!spec) {
    throw new Error(
      `No official ngrok binary is published for ${platform()}/${arch()}. Install ngrok manually or set AGENTX_NGROK_BIN.`,
    );
  }

  const log = getLogger();
  log.info('NGROK_AUTO_INSTALL_START', 'Downloading official ngrok agent into Agent-X data dir', {
    url: spec.url,
    targetPath: input.targetPath,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const workDir = join(tmpdir(), `agentx-ngrok-${process.pid}-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const archivePath = join(workDir, spec.archiveKind === 'zip' ? 'ngrok.zip' : 'ngrok.tgz');
  const extractDir = join(workDir, 'out');
  await mkdir(extractDir, { recursive: true });

  try {
    const res = await fetchImpl(spec.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'User-Agent': 'Agent-X-Host/1.0 (+https://github.com/agent-x)' },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) {
      throw new Error(`ngrok download failed HTTP ${res.status}`);
    }
    const lengthHeader = res.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_ARCHIVE_BYTES) {
      throw new Error('ngrok archive exceeds size limit');
    }

    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    await pipeline(body, createWriteStream(archivePath));

    await extractArchive(archivePath, extractDir, spec.archiveKind);

    const extracted = join(extractDir, spec.binaryName);
    if (!(await fileExists(extracted))) {
      throw new Error(`ngrok archive did not contain ${spec.binaryName}`);
    }

    await mkdir(dirname(input.targetPath), { recursive: true });
    const staging = `${input.targetPath}.tmp-${process.pid}`;
    await rm(staging, { force: true }).catch(() => undefined);
    await rename(extracted, staging);
    if (process.platform !== 'win32') {
      await chmod(staging, 0o755);
    }
    await rename(staging, input.targetPath);

    if (!pathIsExecutable(input.targetPath)) {
      throw new Error('Installed ngrok binary is not executable');
    }

    log.info('NGROK_AUTO_INSTALL_OK', 'ngrok agent installed into Agent-X data dir', {
      targetPath: input.targetPath,
    });
    return input.targetPath;
  } catch (err) {
    log.warn('NGROK_AUTO_INSTALL_FAIL', 'Failed to auto-install ngrok agent', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function extractArchive(archivePath: string, destDir: string, kind: NgrokArchiveKind): Promise<void> {
  if (kind === 'tgz') {
    await runCommand('tar', ['-xzf', archivePath, '-C', destDir]);
    return;
  }

  if (process.platform === 'win32') {
    await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }

  // macOS: ditto handles zip without requiring unzip(1)
  if (process.platform === 'darwin') {
    await runCommand('ditto', ['-x', '-k', archivePath, destDir]);
    return;
  }

  await runCommand('unzip', ['-o', archivePath, '-d', destDir]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (code=${code}): ${stderr.trim() || 'no stderr'}`));
    });
  });
}

/** Test helper — clear in-flight install latch. */
export function __resetNgrokInstallLatchForTests(): void {
  installInFlight = null;
}
