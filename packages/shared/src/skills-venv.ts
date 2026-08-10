import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { getConfigDir } from './platform.js';
import { getLogger } from './logger.js';

const execFileAsync = promisify(execFile);

export const SKILLS_VENV_DIR_NAME = 'skills-venv';

/** Managed skills venv: `{configDir}/skills-venv`. */
export function resolveSkillsVenvPath(): string {
  return join(getConfigDir(), SKILLS_VENV_DIR_NAME);
}

export function resolveSkillsVenvPython(): string {
  const venvPath = resolveSkillsVenvPath();
  const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
  const pythonName = process.platform === 'win32' ? 'python.exe' : 'python';
  return join(venvPath, binDir, pythonName);
}

export function applySkillsVenvEnv(): void {
  const venvPath = resolveSkillsVenvPath();
  const python = resolveSkillsVenvPython();
  if (existsSync(python)) {
    process.env['AGENTX_SKILLS_VENV'] = venvPath;
    process.env['AGENTX_SKILLS_PYTHON'] = python;
  }
}

/**
 * Bootstrap `{configDir}/skills-venv` and install the agent-x-skills-runtime shim.
 * `shimPackagePath` must point to the `agent-x-skills-runtime` package root on disk.
 */
export class SkillsVenvManager {
  private ready = false;

  async ensureReady(shimPackagePath: string): Promise<string> {
    if (this.ready && existsSync(resolveSkillsVenvPython())) {
      applySkillsVenvEnv();
      return resolveSkillsVenvPython();
    }

    const venvPath = resolveSkillsVenvPath();
    const python = resolveSkillsVenvPython();
    mkdirSync(getConfigDir(), { recursive: true });

    if (!existsSync(python)) {
      const basePython = process.env['AGENTX_PYTHON_PATH'] || 'python3';
      getLogger().info('SKILLS_VENV', `Creating skills venv at ${venvPath}`);
      await execFileAsync(basePython, ['-m', 'venv', venvPath], { timeout: 120_000 });
    }

    if (shimPackagePath && existsSync(shimPackagePath)) {
      const pipDir = process.platform === 'win32' ? 'Scripts' : 'bin';
      const pipName = process.platform === 'win32' ? 'pip.exe' : 'pip';
      const pip = join(venvPath, pipDir, pipName);
      const marker = join(venvPath, '.agentx-skills-shim-installed');
      if (!existsSync(marker)) {
        getLogger().info('SKILLS_VENV', `Installing skills runtime shim from ${shimPackagePath}`);
        await execFileAsync(pip, ['install', '-e', shimPackagePath], { timeout: 180_000 });
        mkdirSync(dirname(marker), { recursive: true });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(marker, new Date().toISOString(), 'utf-8');
      }
    }

    applySkillsVenvEnv();
    this.ready = true;
    return resolveSkillsVenvPython();
  }
}

let manager: SkillsVenvManager | null = null;

export function getSkillsVenvManager(): SkillsVenvManager {
  if (!manager) manager = new SkillsVenvManager();
  return manager;
}
