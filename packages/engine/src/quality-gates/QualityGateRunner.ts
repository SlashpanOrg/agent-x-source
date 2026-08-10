import { execSync } from 'node:child_process';
import type { QualityGateConfig, QualityGateResult } from '@agentx/shared';
import { DEFAULT_QUALITY_GATE_CONFIG, isQualityGatesEnabled } from '@agentx/shared';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';
import { withSpan } from '../observability/tracer.js';
import { gitWorktreeSnapshot } from './git-worktree-snapshot.js';

const OUTPUT_CAP = 6000;
const snapshotCache = new Map<string, string>();

function cap(s: string): string {
  return s.length > OUTPUT_CAP ? s.slice(0, OUTPUT_CAP) + '\n...[truncated]' : s;
}

function runCommand(command: string, cwd: string, timeoutMs: number): { exitCode: number | null; output: string } {
  try {
    const out = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      shell: '/bin/bash',
    });
    return { exitCode: 0, output: cap(out ?? '') };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const output = cap([e.stdout, e.stderr, e.message].filter(Boolean).join('\n'));
    return { exitCode: typeof e.status === 'number' ? e.status : 1, output };
  }
}

export class QualityGateRunner {
  isEnabled(): boolean {
    return isQualityGatesEnabled();
  }

  async run(
    config: QualityGateConfig = DEFAULT_QUALITY_GATE_CONFIG,
    cwd = process.cwd(),
    snapshotKey?: string,
    onEvent?: (event: Record<string, unknown>) => void,
  ): Promise<QualityGateResult> {
    return withSpan('quality_gate.run', 'quality_gate', async (span) => {
      span.setAttribute('quality_gate.commands', config.commands?.length ?? 0);
    if (!this.isEnabled() || !config.commands?.length) {
      return { passed: true, failures: [] };
    }

    onEvent?.({ type: 'quality_gate_start', commands: config.commands });

    const snap = gitWorktreeSnapshot(cwd);
    const key = snapshotKey ?? cwd;
    const prev = snapshotCache.get(key);
    if (prev && prev === snap.hash && config.commands.length) {
      return { passed: false, failures: [], skippedDueToSnapshot: true, snapshotHash: snap.hash };
    }

    const maxRetries = config.maxRetries ?? DEFAULT_QUALITY_GATE_CONFIG.maxRetries ?? 3;
    const timeoutMs = config.timeoutMs ?? DEFAULT_QUALITY_GATE_CONFIG.timeoutMs ?? 300000;
    const failures: QualityGateResult['failures'] = [];

    for (const command of config.commands) {
      let passed = false;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { exitCode, output } = runCommand(command, cwd, timeoutMs);
        if (exitCode === 0) {
          passed = true;
          break;
        }
        failures.push({ command, attempt, exitCode, output });
      }
      if (!passed) {
        snapshotCache.set(key, snap.hash);
        incrementAdoptionMetric('quality_gate_fail_total');
        onEvent?.({ type: 'quality_gate_fail', command, failures });
        return { passed: false, failures, snapshotHash: snap.hash };
      }
    }

    snapshotCache.delete(key);
    incrementAdoptionMetric('quality_gate_pass_total');
    onEvent?.({ type: 'quality_gate_pass', snapshotHash: snap.hash });
    return { passed: true, failures: [], snapshotHash: snap.hash };
    });
  }
}

let runnerInstance: QualityGateRunner | null = null;

export function getQualityGateRunner(): QualityGateRunner {
  if (!runnerInstance) runnerInstance = new QualityGateRunner();
  return runnerInstance;
}
