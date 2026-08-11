import { describe, it, expect } from 'vitest';
import { SessionGenerationManager } from '../../src/session-generation/SessionGenerationManager.js';

describe('SessionGenerationManager', () => {
  it('increments sequence without bumping generation when disabled', async () => {
    const mgr = new SessionGenerationManager();
    const a = await mgr.nextEnvelope('s1', { type: 'test', n: 1 });
    const b = await mgr.nextEnvelope('s1', { type: 'test', n: 2 });
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    expect(a.generation).toBe(b.generation);
  });
});
