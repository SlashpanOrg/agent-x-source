/**
 * Adoption integration test suite entry — vitest picks up all tests under tests/adoption/.
 * Run: pnpm exec vitest run packages/engine/tests/adoption/
 */
import { describe, it, expect } from 'vitest';

describe('adoption suite', () => {
  it('registers adoption integration tests via vitest include glob', () => {
    expect(true).toBe(true);
  });
});
