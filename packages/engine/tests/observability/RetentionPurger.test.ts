import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ObservabilityStore } from '../../src/observability/ObservabilityStore.js';
import { RetentionPurger } from '../../src/observability/retention.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.AGENTX_TEST_PG ?? 'postgresql://agentx:agentx@127.0.0.1:3335/agentx';

async function isPgAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

describe.runIf(await isPgAvailable())('RetentionPurger', () => {
  let pool: Pool;
  let store: ObservabilityStore;
  let purger: RetentionPurger;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 2 });
    const sql = readFileSync(join(__dirname, '../../src/db/migrations/V024__observability_schema.sql'), 'utf8');
    await pool.query(sql);
    store = new ObservabilityStore(pool);
  });

  afterAll(async () => {
    try { await pool.query('DROP SCHEMA IF EXISTS observability CASCADE'); } catch { /* ignore */ }
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE observability.traces, observability.spans, observability.logs, observability.metric_samples CASCADE');
    await pool.query('UPDATE observability.config SET retention_days = 30, capture_prompts = true, enabled = true WHERE id = 1');
  });

  it('purges old rows but keeps recent', async () => {
    const oldTs = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const newTs = new Date().toISOString();
    await store.insertTrace({ trace_id: 'old', root_span_id: 'r', domain: 'AGENT', kind: 'turn', status: 'ok', started_at: oldTs, ended_at: oldTs, tool_call_count: 0, cost_usd: 0 });
    await store.insertTrace({ trace_id: 'new', root_span_id: 'r', domain: 'AGENT', kind: 'turn', status: 'ok', started_at: newTs, ended_at: newTs, tool_call_count: 0, cost_usd: 0 });

    await store.updateConfig({ retention_days: 1 });
    purger = new RetentionPurger(store, 1000);
    await purger.runOnce();

    expect(await store.getTrace('old')).toBeUndefined();
    expect(await store.getTrace('new')).toBeDefined();
  });

  it('reads retention_days live from config', async () => {
    const oldTs = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await store.insertTrace({ trace_id: 'old10', root_span_id: 'r', domain: 'AGENT', kind: 'turn', status: 'ok', started_at: oldTs, ended_at: oldTs, tool_call_count: 0, cost_usd: 0 });

    // With retention=30, the 10-day-old trace should survive.
    await store.updateConfig({ retention_days: 30 });
    purger = new RetentionPurger(store, 1000);
    await purger.runOnce();
    expect(await store.getTrace('old10')).toBeDefined();

    // With retention=5, it should be purged.
    await store.updateConfig({ retention_days: 5 });
    await purger.runOnce();
    expect(await store.getTrace('old10')).toBeUndefined();
  });

  it('start/stop controls the interval', () => {
    purger = new RetentionPurger(store, 1000);
    purger.start();
    purger.start(); // idempotent
    purger.stop();
    purger.stop(); // idempotent
  });

  it('runOnce does not throw when config is missing', async () => {
    const mockStore = { getConfig: vi.fn().mockResolvedValue(undefined), purgeOlderThan: vi.fn() } as unknown as ObservabilityStore;
    purger = new RetentionPurger(mockStore, 1000);
    await expect(purger.runOnce()).resolves.toBeUndefined();
  });
});
