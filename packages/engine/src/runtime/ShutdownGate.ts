let shuttingDown = false;

export function markEngineShuttingDown(): void {
  shuttingDown = true;
}

export function isEngineShuttingDown(): boolean {
  return shuttingDown;
}

/** Test-only reset — not for production shutdown flows. */
export function resetEngineShutdownGateForTests(): void {
  shuttingDown = false;
}
