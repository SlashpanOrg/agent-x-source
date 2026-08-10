import { describe, it, expect } from 'vitest';

/** Faux provider stub for integration tests (X-TEST-04). */
export async function fauxComplete(prompt: string): Promise<string> {
  if (prompt.includes('refinement')) {
    return JSON.stringify({
      summary: 'stub',
      rationale: 'test',
      edits: [{ action: 'create', kind: 'memory', title: 'S', content: 'C', reason: 't' }],
    });
  }
  return 'ok';
}

describe('faux provider harness', () => {
  it('returns JSON refinement proposal', async () => {
    const raw = await fauxComplete('refinement planner');
    const parsed = JSON.parse(raw);
    expect(parsed.edits.length).toBe(1);
  });
});
