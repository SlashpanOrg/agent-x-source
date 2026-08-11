import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventBus } from '../../src/EventBus.js';
import type { EngineEvent, AgentXConfig } from '@agentx/shared';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { SubAgentManager } from '../../src/agent/SubAgentManager.js';

describe('SubAgentManager admitted completion', () => {
  beforeEach(() => {
    configureAdoptionFromConfig({
      adoption: { interAgentMessaging: { enabled: false } },
    } as AgentXConfig);
  });

  it('emits subagent_admitted_complete on notifyParentSubAgentComplete', () => {
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));

    const mgr = new SubAgentManager(bus);
    (mgr as unknown as { parentSessionId: string | null }).parentSessionId = 'parent-sess';

    const task = {
      id: 'sub-task-1',
      instruction: 'test',
      tools: [],
      timeout: 60_000,
      status: 'completed' as const,
      childSessionId: 'sub-task-1',
      background: true,
      parentSessionId: 'parent-sess',
    };
    (mgr as unknown as { agents: Map<string, unknown> }).agents = new Map([['sub-task-1', task]]);

    mgr.notifyParentSubAgentComplete('sub-task-1', 'done output', true);

    const complete = events.find((e) => e.type === 'subagent_admitted_complete');
    expect(complete).toBeDefined();
    if (complete?.type === 'subagent_admitted_complete') {
      expect(complete.taskId).toBe('sub-task-1');
      expect(complete.parentSessionId).toBe('parent-sess');
      expect(complete.success).toBe(true);
    }
  });
});
