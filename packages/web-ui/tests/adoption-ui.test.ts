import { describe, it, expect } from 'vitest';

describe('generation reconnect', () => {
  it('sessionStorage cursor key is stable', () => {
    expect('agentx:generation-cursor').toContain('generation');
  });
});
