import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IS_LINUX, ensureLoginShellPath } from '@agentx/shared';
import { checkCommandExists, getShellCommand } from '../tools/platform.js';

export const OCR_STACK_TOOL_ID = 'ocr-stack' as const;

export type OcrInstallerId = 'brew' | 'apt' | 'dnf' | 'pacman' | 'scoop' | 'choco' | 'winget';

export type OcrToolStatus = {
  id: typeof OCR_STACK_TOOL_ID;
  name: string;
  description: string;
  installed: boolean;
  missing: string[];
  installer: OcrInstallerId | null;
  canInstall: boolean;
  command: string | null;
  elevation: boolean;
};

export type OcrInstallJob = {
  id: string;
  toolId: typeof OCR_STACK_TOOL_ID;
  status: 'installing' | 'ready' | 'failed';
  message: string;
};

export type OcrToolProbe = {
  platform: 'darwin' | 'linux' | 'win32';
  commandExists: (cmd: string) => boolean;
  pathExists: (p: string) => boolean;
  envPath: string;
  home: string;
  localAppData?: string;
  canPasswordlessSudo?: boolean;
};

const INSTALL_COMMANDS: Record<OcrInstallerId, string> = {
  brew: 'brew install tesseract poppler',
  apt: 'sudo -n apt-get update -qq && sudo -n apt-get install -y tesseract-ocr poppler-utils',
  dnf: 'sudo -n dnf install -y tesseract poppler-utils',
  pacman: 'sudo -n pacman -S --noconfirm tesseract tesseract-data-eng poppler',
  scoop: 'scoop bucket add extras 2>nul & scoop install tesseract poppler',
  choco: 'choco install tesseract poppler -y',
  winget:
    'winget install -e --id UB-Mannheim.TesseractOCR --accept-package-agreements --accept-source-agreements && winget install -e --id oschwartz10612.Poppler --accept-package-agreements --accept-source-agreements',
};

const jobs = new Map<string, OcrInstallJob>();
const running = new Map<string, string>();

function defaultProbe(): OcrToolProbe {
  return {
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    commandExists: checkCommandExists,
    pathExists: existsSync,
    envPath: process.env.PATH ?? '',
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
    canPasswordlessSudo: IS_LINUX ? canPasswordlessSudo() : undefined,
  };
}

function canPasswordlessSudo(): boolean {
  try {
    execSync('sudo -n true', { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export function extraOcrPathDirs(probe: OcrToolProbe): string[] {
  if (probe.platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin'];
  if (probe.platform === 'linux') return ['/usr/bin', '/usr/local/bin'];
  const local = probe.localAppData || join(probe.home, 'AppData', 'Local');
  return [
    'C:\\Program Files\\Tesseract-OCR',
    'C:\\Program Files (x86)\\Tesseract-OCR',
    join(local, 'Programs', 'Tesseract-OCR'),
    'C:\\Program Files\\poppler\\Library\\bin',
    'C:\\ProgramData\\chocolatey\\bin',
  ];
}

export function prependOcrToolPath(probe: OcrToolProbe = defaultProbe()): void {
  const sep = probe.platform === 'win32' ? ';' : ':';
  const current = (process.env.PATH ?? probe.envPath).split(sep).filter(Boolean);
  const extra = extraOcrPathDirs(probe).filter((dir) => probe.pathExists(dir) && !current.includes(dir));
  if (extra.length === 0) return;
  process.env.PATH = [...extra, ...current].join(sep);
}

export function detectOcrInstaller(probe: OcrToolProbe): OcrInstallerId | null {
  if (probe.platform === 'darwin' && probe.commandExists('brew')) return 'brew';
  if (probe.platform === 'win32') {
    if (probe.commandExists('scoop')) return 'scoop';
    if (probe.commandExists('choco')) return 'choco';
    if (probe.commandExists('winget')) return 'winget';
    return null;
  }
  if (probe.pathExists('/usr/bin/apt-get') || probe.commandExists('apt-get')) return 'apt';
  if (probe.commandExists('dnf')) return 'dnf';
  if (probe.commandExists('pacman')) return 'pacman';
  return null;
}

export function missingOcrBinaries(probe: OcrToolProbe): string[] {
  const missing: string[] = [];
  if (!probe.commandExists('tesseract')) missing.push('tesseract');
  if (!probe.commandExists('pdftoppm')) missing.push('pdftoppm');
  return missing;
}

export function getOcrToolStatus(probe?: OcrToolProbe): OcrToolStatus {
  const env = probe ?? defaultProbe();
  if (!probe) {
    ensureLoginShellPath();
    prependOcrToolPath(env);
  }
  const missing = missingOcrBinaries(env);
  const installer = detectOcrInstaller(env);
  const command = installer ? INSTALL_COMMANDS[installer] : null;
  const elevation = installer === 'apt' || installer === 'dnf' || installer === 'pacman';
  const canInstall = Boolean(installer) && (!elevation || env.canPasswordlessSudo !== false);
  return {
    id: OCR_STACK_TOOL_ID,
    name: 'PDF OCR',
    description: 'Tesseract + Poppler — required to ingest scanned or image-only PDFs.',
    installed: missing.length === 0,
    missing,
    installer,
    canInstall,
    command,
    elevation,
  };
}

export function errorNeedsOcrTools(error: string | undefined): boolean {
  if (!error) return false;
  return /scanned pdf|ocr tools missing|tesseract not found|pdftoppm not found|poppler/i.test(error);
}

export function getOcrInstallJob(jobId: string): OcrInstallJob | null {
  return jobs.get(jobId) ?? null;
}

export function startOcrStackInstall(probe: OcrToolProbe = defaultProbe()): OcrInstallJob {
  const existingId = running.get(OCR_STACK_TOOL_ID);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && existing.status === 'installing') return existing;
  }

  const status = getOcrToolStatus(probe);
  if (status.installed) {
    const job: OcrInstallJob = {
      id: `ocr-${Date.now()}`,
      toolId: OCR_STACK_TOOL_ID,
      status: 'ready',
      message: 'PDF OCR tools are already installed.',
    };
    jobs.set(job.id, job);
    return job;
  }
  if (!status.command) {
    const job: OcrInstallJob = {
      id: `ocr-${Date.now()}`,
      toolId: OCR_STACK_TOOL_ID,
      status: 'failed',
      message:
        'No package manager found. Install Tesseract and Poppler, then retry. macOS: brew install tesseract poppler · Linux: sudo apt-get install tesseract-ocr poppler-utils · Windows: winget install UB-Mannheim.TesseractOCR',
    };
    jobs.set(job.id, job);
    return job;
  }

  const job: OcrInstallJob = {
    id: `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolId: OCR_STACK_TOOL_ID,
    status: 'installing',
    message: `Installing PDF OCR with ${status.installer}…`,
  };
  jobs.set(job.id, job);
  running.set(OCR_STACK_TOOL_ID, job.id);

  const { cmd, args } = getShellCommand(status.command);
  const child = spawn(cmd, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let errTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    errTail = (errTail + chunk.toString('utf8')).slice(-800);
  });
  child.on('error', (err) => {
    job.status = 'failed';
    job.message = err.message;
    running.delete(OCR_STACK_TOOL_ID);
  });
  child.on('close', (code) => {
    prependOcrToolPath();
    const after = getOcrToolStatus();
    if (code === 0 && after.installed) {
      job.status = 'ready';
      job.message = 'PDF OCR installed. Reloading…';
    } else if (code === 0) {
      job.status = 'failed';
      job.message = `Installer finished but ${after.missing.join(' and ') || 'OCR tools'} still missing. Restart Agent-X if they were just added to PATH.`;
    } else {
      job.status = 'failed';
      job.message = errTail.trim() || `Install failed (exit ${code}). Try: ${status.command}`;
    }
    running.delete(OCR_STACK_TOOL_ID);
  });

  return job;
}
