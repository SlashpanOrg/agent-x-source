import { describe, it, expect } from 'vitest';

describe('V006 migration registry', () => {
  it('includes prime_adoption migration', async () => {
    const { MIGRATION_FILES } = await import('../src/db/migration-registry.js');
    const ids = MIGRATION_FILES.map((m) => m.name);
    expect(ids.some((name) => name.includes('prime_adoption'))).toBe(true);
  });
});
