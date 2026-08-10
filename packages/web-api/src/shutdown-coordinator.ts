import { getSessionLeaseManager, releaseAllSessionLeaseManagers, getResidentSessionManager } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { turnRegistry } from './turn-registry.js';

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function drainForShutdown(timeoutMs = 30_000): Promise<void> {
  markShuttingDown();
  const log = getLogger();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!turnRegistry.hasActiveTurns()) break;
    log.info('SHUTDOWN', 'Waiting for in-flight turns…');
    await sleep(500);
  }
  if (turnRegistry.hasActiveTurns()) {
    log.warn('SHUTDOWN', 'Shutdown timeout — some turns may still be active');
  }
  try {
    await releaseAllSessionLeaseManagers();
  } catch { /* best-effort */ }
  try {
    if (getResidentSessionManager().isEnabled()) {
      await getResidentSessionManager().sweepIdleResidents();
    }
  } catch { /* best-effort */ }
}
