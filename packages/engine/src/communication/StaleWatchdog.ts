export class StaleWatchdog {
  private firstByteTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();
  private firstByteReceived = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  constructor(
    private firstByteTimeoutMs: number = 90000,
    private stallTimeoutMs: number = 60000,
  ) {
    this.startTimers();
  }

  markFirstByte(): void {
    this.firstByteReceived = true;
    if (this.firstByteTimer) {
      clearTimeout(this.firstByteTimer);
      this.firstByteTimer = null;
    }
    this.resetStallTimer();
  }

  poke(): void {
    if (this.firstByteReceived) {
      this.resetStallTimer();
    }
  }

  clear(): void {
    if (this.firstByteTimer) {
      clearTimeout(this.firstByteTimer);
      this.firstByteTimer = null;
    }
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  abort(): void {
    this.controller.abort();
  }

  private startTimers(): void {
    this.firstByteTimer = setTimeout(() => {
      if (!this.firstByteReceived) {
        this.controller.abort(
          new Error(
            `No first byte received within ${this.firstByteTimeoutMs}ms`,
          ),
        );
      }
    }, this.firstByteTimeoutMs);

    this.resetStallTimer();
  }

  private resetStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
    }

    this.stallTimer = setTimeout(() => {
      this.controller.abort(
        new Error(
          `Stream stalled: no events received within ${this.stallTimeoutMs}ms`,
        ),
      );
    }, this.stallTimeoutMs);
  }
}
