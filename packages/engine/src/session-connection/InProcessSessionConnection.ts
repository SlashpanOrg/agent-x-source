import type { EngineEvent, GoalState } from '@agentx/shared';
import { getGoalService } from '../goal/GoalService.js';
import type { Agent } from '../agent/Agent.js';
import type { SessionConnection, SessionSnapshot } from './SessionConnection.js';

export class InProcessSessionConnection implements SessionConnection {
  constructor(
    private readonly agent: Agent,
    public readonly sessionId: string = agent.sessionId,
  ) {}

  async sendMessage(content: string, options?: Record<string, unknown>): Promise<unknown> {
    return this.agent.sendMessage(content, options as never);
  }

  cancel(): void {
    this.agent.cancel();
  }

  subscribeEvents(handler: (event: EngineEvent) => void): () => void {
    return this.agent.events.on(handler);
  }

  async getSnapshot(): Promise<SessionSnapshot> {
    return {
      sessionId: this.sessionId,
      messages: this.agent.messages,
    };
  }

  async refineHarness(instructions?: string, scope: 'local' | 'global' = 'local'): Promise<{ ok: boolean; error?: string }> {
    return this.agent.refineHarness(instructions, scope);
  }

  getGoal(): GoalState {
    return getGoalService().getStatus(this.sessionId);
  }

  activateGoal(objective: string, budget?: Record<string, unknown>): GoalState {
    return getGoalService().activate(this.sessionId, objective, budget as never);
  }

  pauseGoal(): GoalState {
    return getGoalService().pause(this.sessionId);
  }

  resumeGoal(): GoalState {
    return getGoalService().resume(this.sessionId);
  }

  completeGoal(): GoalState {
    return getGoalService().complete(this.sessionId);
  }

  clearGoal(): GoalState {
    return getGoalService().clear(this.sessionId);
  }
}

export function createInProcessSessionConnection(agent: Agent): InProcessSessionConnection {
  return new InProcessSessionConnection(agent);
}
