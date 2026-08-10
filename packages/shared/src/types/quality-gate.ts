/** Autonomous quality gates before task completion (Prime Agent adoption). */

export interface QualityGateConfig {
  commands: string[];
  maxRetries?: number;
  timeoutMs?: number;
}

export interface QualityGateFailure {
  command: string;
  attempt: number;
  exitCode: number | null;
  output: string;
}

export interface QualityGateResult {
  passed: boolean;
  failures: QualityGateFailure[];
  skippedDueToSnapshot?: boolean;
  snapshotHash?: string;
}

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  commands: [],
  maxRetries: 3,
  timeoutMs: 5 * 60 * 1000,
};
