import type { AgentXStreamEvent } from '@agentx/shared';

const DEFAULT_THROTTLE_MS = 150;

export interface BroadcastTarget {
  connId: string;
  sessionId: string;
  send(event: Record<string, unknown>): void;
}

export class EventBroadcaster {
  private targets = new Map<string, BroadcastTarget>();
  private lastBroadcast = new Map<string, number>();
  private readonly throttleMs: number;

  constructor(throttleMs: number = DEFAULT_THROTTLE_MS) {
    this.throttleMs = throttleMs;
  }

  register(target: BroadcastTarget): void {
    this.targets.set(target.connId, target);
  }

  unregister(connId: string): void {
    this.targets.delete(connId);
  }

  broadcast(event: AgentXStreamEvent): void {
    this.sendToTargets(Array.from(this.targets.values()), event);
  }

  broadcastToSession(event: AgentXStreamEvent, sessionId: string): void {
    const targets = Array.from(this.targets.values()).filter(
      (t) => t.sessionId === sessionId,
    );
    this.sendToTargets(targets, event);
  }

  broadcastToConnIds(event: AgentXStreamEvent, connIds: string[]): void {
    const targets = connIds
      .map((id) => this.targets.get(id))
      .filter((t): t is BroadcastTarget => t !== undefined);
    this.sendToTargets(targets, event);
  }

  sendToSession(event: AgentXStreamEvent, sessionId: string): void {
    this.broadcastToSession(event, sessionId);
  }

  getTargetCount(): number {
    return this.targets.size;
  }

  getSessionTargetCount(sessionId: string): number {
    return Array.from(this.targets.values()).filter(
      (t) => t.sessionId === sessionId,
    ).length;
  }

  private sendToTargets(
    targets: BroadcastTarget[],
    event: AgentXStreamEvent,
  ): void {
    const shouldThrottle = event.type === 'text.delta';

    if (shouldThrottle) {
      const now = Date.now();
      const last = this.lastBroadcast.get(event.messageId) ?? 0;
      if (now - last < this.throttleMs) return;
      this.lastBroadcast.set(event.messageId, now);
    }

    const payload = this.toPayload(event);

    for (const target of targets) {
      try {
        target.send(payload);
      } catch {
        this.targets.delete(target.connId);
      }
    }
  }

  private toPayload(event: AgentXStreamEvent): Record<string, unknown> {
    return { ...event };
  }
}
