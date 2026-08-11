/** Lead time before the user-facing run time — worker spins up early, then waits until targetRunAt. */
export const AUTOMATION_RUN_LEAD_MS = 20_000;

/** Default quality gate command templates when adoption.qualityGates is enabled (P1-GATE-INT-06). */
export const DEFAULT_AUTOMATION_QUALITY_GATE_COMMANDS = [
  'npm test --if-present',
  'npm run lint --if-present',
] as const;
