import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentXConfig } from '@agentx/shared';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { AgentBus } from '../../src/agent/AgentBus.js';

describe('AgentBus.sendToSession', () => {
  afterEach(() => {
    configureAdoptionFromConfig(null);
  });

  it('falls back to publish when inter-agent messaging disabled', async () => {
    configureAdoptionFromConfig(null);
    const bus = new AgentBus();
    let received = false;
    bus.subscribe('child', 'ping', () => {
      received = true;
    });
    bus.registerAgent('child', ['ping']);
    const msg = await bus.sendToSession('parent', 'child', 'ping', { text: 'hi' });
    expect(msg.topic).toBe('ping');
    expect(received).toBe(true);
  });

  it('emits agent_message event when routing', async () => {
    configureAdoptionFromConfig({
      adoption: { interAgentMessaging: { enabled: true } },
    } as AgentXConfig);
    const bus = new AgentBus();
    const events: string[] = [];
    bus.attachEventBus({
      emit: (ev) => {
        if (ev.type === 'agent_message') events.push('agent_message');
      },
      on: () => () => {},
      off: () => {},
    });
    await bus.sendToSession('sess-a', 'sess-b', 'note', { text: 'hello' }, 'auto', 'sibling');
    expect(events).toContain('agent_message');
  });
});
