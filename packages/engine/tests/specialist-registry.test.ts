import { describe, it, expect } from 'vitest';

describe('SpecialistRegistry', () => {
  it('module can be imported', async () => {
    const { SpecialistRegistry } = await import('../src/agent/SpecialistRegistry.js');
    expect(SpecialistRegistry).toBeDefined();
  });
});

describe('AgentBus', () => {
  it('module can be imported', async () => {
    const { AgentBus } = await import('../src/agent/AgentBus.js');
    expect(AgentBus).toBeDefined();
  });
});
