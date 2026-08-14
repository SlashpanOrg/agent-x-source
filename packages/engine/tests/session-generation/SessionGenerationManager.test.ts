import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionGenerationManager } from '../../src/session-generation/SessionGenerationManager.js';
import { setAdoptionDbPool } from '../../src/adoption/adoption-db.js';

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

describe('SessionGenerationManager persistence', () => {
  afterEach(() => {
    setAdoptionDbPool(null);
  });

  function enabledMgr(query: ReturnType<typeof vi.fn>): SessionGenerationManager {
    setAdoptionDbPool({ query } as never);
    const mgr = new SessionGenerationManager();
    vi.spyOn(mgr, 'isEnabled').mockReturnValue(true);
    return mgr;
  }

  it('does not insert a generation row when the session is missing', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT generation')) return { rows: [] };
      if (sql.includes('INSERT INTO session_generations')) return { rows: [] };
      return { rows: [] };
    });
    const mgr = enabledMgr(query);
    await expect(mgr.getGeneration('stale-after-repack')).resolves.toBe(0);
    const insertSql = String(query.mock.calls.find((c) => String(c[0]).includes('INSERT'))?.[0] ?? '');
    expect(insertSql).toContain('FROM sessions');
    expect(insertSql).toContain('WHERE id = $1');
  });

  it('returns 0 on a session_id foreign-key violation instead of throwing', async () => {
    const query = vi.fn(async () => {
      const err = Object.assign(new Error('insert or update on table "session_generations" violates foreign key constraint "session_generations_session_id_fkey"'), {
        code: '23503',
        constraint: 'session_generations_session_id_fkey',
      });
      throw err;
    });
    const mgr = enabledMgr(query);
    await expect(mgr.getGeneration('missing-session')).resolves.toBe(0);
    await expect(mgr.bumpGeneration('missing-session')).resolves.toBe(0);
  });

  it('reads an existing generation', async () => {
    const query = vi.fn(async () => ({ rows: [{ generation: 4 }] }));
    const mgr = enabledMgr(query);
    await expect(mgr.getGeneration('sess-1')).resolves.toBe(4);
  });
});
