import type { EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';

const STEER_RATE_LIMIT_MS = 3000;

export class SteerMessageHandler {
  private eventBus: AgentEventBus;
  private lastSteerTime = 0;
  private lastSteerBySession = new Map<string, number>();

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  handleSteer(taskId: string, instruction: string): boolean {
    const now = Date.now();
    if (now - this.lastSteerTime < STEER_RATE_LIMIT_MS) {
      return false; // Rate limited
    }

    this.lastSteerTime = now;
    this.eventBus.emit({
      type: 'steer_message',
      taskId,
      instruction,
    } as EngineEvent);

    return true;
  }

  /** Session-targeted steer with per-session rate limiting (Phase 3 IAM). */
  handleSessionSteer(sessionId: string, instruction: string): boolean {
    const now = Date.now();
    const last = this.lastSteerBySession.get(sessionId) ?? 0;
    if (now - last < STEER_RATE_LIMIT_MS) {
      return false;
    }
    this.lastSteerBySession.set(sessionId, now);
    this.lastSteerTime = now;
    this.eventBus.emit({
      type: 'steer_message',
      taskId: sessionId,
      instruction,
    } as EngineEvent);
    return true;
  }

  canSteer(): boolean {
    return Date.now() - this.lastSteerTime >= STEER_RATE_LIMIT_MS;
  }
}
