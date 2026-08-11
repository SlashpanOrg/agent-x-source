import { describe, it, expect } from 'vitest';

/** Mirrors generation reconnect warning logic in useChatTelemetry. */
export function shouldWarnGenerationResync(storedGen: number, serverGen: number): boolean {
  return storedGen > 0 && storedGen !== serverGen;
}

describe('generation reconnect cursor', () => {
  it('warns when stored generation differs from server snapshot', () => {
    expect(shouldWarnGenerationResync(3, 4)).toBe(true);
    expect(shouldWarnGenerationResync(0, 1)).toBe(false);
    expect(shouldWarnGenerationResync(5, 5)).toBe(false);
  });

  it('simulates WS attach replay vs snapshot modes', () => {
    const clientGen = 2;
    const serverGen = 2;
    const mode = clientGen === serverGen ? 'replay' : 'snapshot';
    expect(mode).toBe('replay');

    const staleClientGen = 1;
    const mode2 = staleClientGen === serverGen ? 'replay' : 'snapshot';
    expect(mode2).toBe('snapshot');
  });
});
