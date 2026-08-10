import { getSessionLeaseManager } from '../session-lease/SessionLeaseManager.js';
import type { SessionLeaseManager } from '../session-lease/SessionLeaseManager.js';
import { SessionAlreadyActiveError } from '../session-lease/errors.js';

export class RunStateManager {
  private runningSessions = new Map<string, AbortController>();
  private backgroundJobs = new Map<string, AbortController[]>();
  private leaseHeartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private readonly leaseManager: SessionLeaseManager;

  constructor(leaseOwnerNamespace?: string) {
    this.leaseManager = getSessionLeaseManager(leaseOwnerNamespace);
  }

  private clearLeaseHeartbeat(sessionId: string): void {
    const timer = this.leaseHeartbeats.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.leaseHeartbeats.delete(sessionId);
    }
  }

  private startLeaseHeartbeat(sessionId: string): void {
    const lease = this.leaseManager;
    if (!lease.isEnabled()) return;
    this.clearLeaseHeartbeat(sessionId);
    const timer = setInterval(() => {
      void lease.renew(sessionId).catch(() => { /* best-effort */ });
    }, 30_000);
    this.leaseHeartbeats.set(sessionId, timer);
  }

  isRunning(sessionId: string): boolean {
    return this.runningSessions.has(sessionId);
  }

  async ensureRunning(sessionId: string): Promise<AbortSignal> {
    if (this.runningSessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" already has an active run`);
    }

    const lease = this.leaseManager;
    if (lease.isEnabled()) {
      const acquired = await lease.acquire(sessionId);
      if (!acquired) {
        const holder = await lease.getHolderOwnerId(sessionId);
        throw new SessionAlreadyActiveError(holder);
      }
    }

    const controller = new AbortController();
    this.runningSessions.set(sessionId, controller);
    this.startLeaseHeartbeat(sessionId);
    return controller.signal;
  }

  cancel(sessionId: string): void {
    const controller = this.runningSessions.get(sessionId);
    if (controller) {
      controller.abort();
      this.runningSessions.delete(sessionId);
    }

    const jobs = this.backgroundJobs.get(sessionId);
    if (jobs) {
      for (const jobCtrl of jobs) {
        jobCtrl.abort();
      }
      this.backgroundJobs.delete(sessionId);
    }

    void this.leaseManager.release(sessionId);
    this.clearLeaseHeartbeat(sessionId);
  }

  release(sessionId: string): void {
    this.runningSessions.delete(sessionId);
    void this.leaseManager.release(sessionId);
    this.clearLeaseHeartbeat(sessionId);
  }

  isCancelled(sessionId: string): boolean {
    const controller = this.runningSessions.get(sessionId);
    return controller?.signal.aborted ?? false;
  }

  startBackgroundJob(sessionId: string, signal: AbortSignal): AbortController {
    const controller = new AbortController();
    signal.addEventListener('abort', () => {
      controller.abort();
    });
    const jobs = this.backgroundJobs.get(sessionId) ?? [];
    jobs.push(controller);
    this.backgroundJobs.set(sessionId, jobs);
    return controller;
  }

  cancelAll(): void {
    for (const [sessionId] of this.runningSessions) {
      this.cancel(sessionId);
    }
  }

  getRunningSessions(): string[] {
    return Array.from(this.runningSessions.keys());
  }

  getRunningCount(): number {
    return this.runningSessions.size;
  }
}
