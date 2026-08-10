import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  getSkillsVenvManager,
  resolveSkillsVenvPython,
  isExecutableSkillsEnabled,
  getLogger,
} from '@agentx/shared';
import type { ExecutableSkillManifest } from '@agentx/shared';
import { getExecutableSkillRegistry } from './ExecutableSkillRegistry.js';

export interface ExecutableSkillRunResult {
  success: boolean;
  output: string;
  error?: string;
  elapsed: number;
  exitCode?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 30_000;

async function ensureSkillsPython(): Promise<string> {
  const shimPath = process.env['AGENTX_SKILLS_RUNTIME_SHIM'];
  if (shimPath) {
    return await getSkillsVenvManager().ensureReady(shimPath);
  }
  const existing = resolveSkillsVenvPython();
  if (existing && existsSync(existing)) {
    return existing;
  }
  return process.env['AGENTX_PYTHON_PATH'] || 'python3';
}

function runSubprocess(
  python: string,
  args: string[],
  timeoutMs: number,
  maxOutput: number,
): Promise<ExecutableSkillRunResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(python, args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
      if (stdout.length > maxOutput * 2) stdout = stdout.slice(0, maxOutput * 2);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
      if (stderr.length > maxOutput) stderr = stderr.slice(0, maxOutput);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - start;
      const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
      const truncated =
        combined.length > maxOutput
          ? `${combined.slice(0, maxOutput)}\n… [output truncated at ${maxOutput} chars]`
          : combined;
      if (killed) {
        resolve({
          success: false,
          output: truncated || 'Skill timed out',
          error: 'TIMEOUT',
          elapsed,
          exitCode: code ?? -1,
        });
        return;
      }
      resolve({
        success: code === 0,
        output: truncated || '(no output)',
        error: code === 0 ? undefined : 'EXEC_ERROR',
        elapsed,
        exitCode: code ?? -1,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: err.message,
        error: 'SPAWN_ERROR',
        elapsed: Date.now() - start,
      });
    });
  });
}

export async function runExecutableSkill(
  name: string,
  args: Record<string, unknown> = {},
  options?: { timeoutMs?: number; maxOutput?: number },
): Promise<ExecutableSkillRunResult> {
  if (!isExecutableSkillsEnabled()) {
    return {
      success: false,
      output: 'Executable skills disabled (adoption.executableSkills)',
      error: 'DISABLED',
      elapsed: 0,
    };
  }

  const registry = getExecutableSkillRegistry();
  const manifest = registry.get(name);
  if (!manifest) {
    return {
      success: false,
      output: `Executable skill not found: ${name}`,
      error: 'NOT_FOUND',
      elapsed: 0,
    };
  }

  const python = await ensureSkillsPython();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = options?.maxOutput ?? DEFAULT_MAX_OUTPUT;
  const argsJson = JSON.stringify(args ?? {});

  getLogger().info('EXEC_SKILL', `Running skill ${name} via ${python}`);

  return runSubprocess(
    python,
    [
      '-m',
      'agent_x_skills_runtime.runner',
      '--skill-path',
      manifest.packagePath,
      '--args-json',
      argsJson,
      '--entrypoint',
      manifest.entrypoint ?? 'run.py',
    ],
    timeoutMs,
    maxOutput,
  );
}

export function resolveExecutableSkillForHarnessRef(reference: Record<string, unknown>): ExecutableSkillManifest | undefined {
  const skillName =
    (reference.executableSkill as string | undefined)
    ?? (reference.name as string | undefined)
    ?? (reference.skill as string | undefined);
  if (!skillName) return undefined;
  return getExecutableSkillRegistry().get(skillName);
}
