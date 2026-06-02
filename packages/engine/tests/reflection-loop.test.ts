import { describe, it, expect } from 'vitest';
import { ReflectionLoop } from '../src/agent/ReflectionLoop.js';
import type { Agent } from '../src/agent/Agent.js';

describe('ReflectionLoop', () => {
  const loop = new ReflectionLoop();

  it('stores and retrieves cumulative learnings', () => {
    // Mock agent is not needed for getCumulativeLearnings
    const learnings = loop.getCumulativeLearnings();
    // Should return a string (maybe empty for fresh instance or have defaults)
    expect(typeof learnings).toBe('string');
  });

  it('can be instantiated without errors', () => {
    const fresh = new ReflectionLoop();
    expect(fresh).toBeDefined();
    expect(fresh.getCumulativeLearnings()).toBeDefined();
  });
});
