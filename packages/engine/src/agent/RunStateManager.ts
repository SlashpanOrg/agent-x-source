export class RunStateManager {
  private runningSessions = new Map<string, AbortController>();
  private backgroundJobs = new Map<string, AbortController[]>();

  isRunning(sessionId: string): boolean {
    return this.runningSessions.has(sessionId);
  }

  ensureRunning(sessionId: string): AbortSignal {
    if (this.runningSessions.has(sessionId)) {
      throw new Error(
        `Session "${sessionId}" already has an active run`,
      );
    }

    const controller = new AbortController();
    this.runningSessions.set(sessionId, controller);
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
  }

  release(sessionId: string): void {
    this.runningSessions.delete(sessionId);
  }

  isCancelled(sessionId: string): boolean {
    const controller = this.runningSessions.get(sessionId);
    return controller?.signal.aborted ?? false;
  }

  startBackgroundJob(
    sessionId: string,
    signal: AbortSignal,
  ): AbortController {
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
