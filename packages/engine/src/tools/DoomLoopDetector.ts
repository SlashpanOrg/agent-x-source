export interface DoomLoopState {
  lastToolCalls: Array<{
    name: string;
    args: string;
    timestamp: number;
  }>;
  consecutiveIdentical: number;
}

export interface DoomLoopResult {
  isDoomLoop: boolean;
  consecutiveCount: number;
  shouldBreak: boolean;
}

export class DoomLoopDetector {
  private states = new Map<string, DoomLoopState>();
  private readonly MAX_CONSECUTIVE_IDENTICAL = 3;

  check(sessionId: string, toolName: string, args: Record<string, unknown>): DoomLoopResult {
    const state = this.getOrCreateState(sessionId);
    const argsStr = JSON.stringify(args);

    const last = state.lastToolCalls.at(-1);

    if (last && last.name === toolName && last.args === argsStr) {
      state.consecutiveIdentical++;
    } else {
      state.consecutiveIdentical = 1;
    }

    state.lastToolCalls.push({
      name: toolName,
      args: argsStr,
      timestamp: Date.now(),
    });

    // Keep only last 10 calls
    if (state.lastToolCalls.length > 10) {
      state.lastToolCalls = state.lastToolCalls.slice(-10);
    }

    const isDoomLoop = state.consecutiveIdentical >= this.MAX_CONSECUTIVE_IDENTICAL;

    return {
      isDoomLoop,
      consecutiveCount: state.consecutiveIdentical,
      shouldBreak: isDoomLoop,
    };
  }

  reset(sessionId: string): void {
    this.states.delete(sessionId);
  }

  resetAll(): void {
    this.states.clear();
  }

  getConsecutiveCount(sessionId: string): number {
    return this.states.get(sessionId)?.consecutiveIdentical ?? 0;
  }

  getRecentCalls(sessionId: string): Array<{ name: string; args: string }> {
    return [...(this.states.get(sessionId)?.lastToolCalls ?? [])];
  }

  private getOrCreateState(sessionId: string): DoomLoopState {
    if (!this.states.has(sessionId)) {
      this.states.set(sessionId, {
        lastToolCalls: [],
        consecutiveIdentical: 0,
      });
    }
    return this.states.get(sessionId)!;
  }
}
