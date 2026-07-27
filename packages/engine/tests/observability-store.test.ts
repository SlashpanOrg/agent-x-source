import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ObservabilityStore, type TraceInsert } from '../src/observability/ObservabilityStore.js';
import type { SpanNode } from '@agentx/shared';

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

describe.runIf(await isPgAvailable())('ObservabilityStore', () => {
  let pool: Pool;
  let store: ObservabilityStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 2 });
    const sql = readFileSync(
      join(__dirname, '../src/db/migrations/V024__observability_schema.sql'),
      'utf8',
    );
    await pool.query(sql);
    store = new ObservabilityStore(pool);
  });

  afterAll(async () => {
    try {
      await pool.query('DROP SCHEMA IF EXISTS observability CASCADE');
    } catch {
      // ignore cleanup errors
    }
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE observability.traces, observability.spans, observability.logs, observability.metric_samples CASCADE');
  });

  it('inserts and reads back a trace with nested spans', async () => {
    const traceId = 'trace-1';
    const trace: TraceInsert = {
      trace_id: traceId,
      root_span_id: 'span-root',
      domain: 'AGENT',
      kind: 'turn',
      session_id: 'session-1',
      turn_id: 'turn-1',
      user_text: 'Hello',
      status: 'ok',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 100,
      provider: 'openai',
      model: 'gpt-4o',
      input_tokens: 10,
      output_tokens: 5,
      tool_call_count: 0,
      cost_usd: 0.0001,
    };

    await store.insertTrace(trace);

    const spans: SpanNode[] = [
      {
        span_id: 'span-root',
        trace_id: traceId,
        domain: 'AGENT',
        name: 'turn',
        kind: 'internal',
        status: 'ok',
        started_at: trace.started_at,
        ended_at: trace.ended_at,
        duration_ms: 100,
        attributes: {},
        events: [],
        children: [],
      },
      {
        span_id: 'span-child',
        trace_id: traceId,
        parent_span_id: 'span-root',
        domain: 'AGENT',
        name: 'llm.chat',
        kind: 'llm',
        status: 'ok',
        started_at: trace.started_at,
        ended_at: trace.ended_at,
        duration_ms: 50,
        attributes: { 'gen_ai.system': 'openai' },
        events: [],
        children: [],
      },
    ];

    await store.insertSpans(spans);

    const detail = await store.getTrace(traceId);
    expect(detail).toBeDefined();
    expect(detail!.trace_id).toBe(traceId);
    expect(detail!.spans).toHaveLength(1);
    expect(detail!.spans[0]!.children).toHaveLength(1);
    expect(detail!.spans[0]!.children[0]!.parent_span_id).toBe('span-root');
    expect(detail!.spans[0]!.children[0]!.kind).toBe('llm');
  });

  it('upserts a running trace to completed', async () => {
    const traceId = 'trace-running';
    const started = new Date().toISOString();

    await store.insertTrace({
      trace_id: traceId,
      root_span_id: 'root',
      domain: 'AGENT',
      kind: 'turn',
      status: 'running',
      started_at: started,
      tool_call_count: 0,
      cost_usd: 0,
    });

    const ended = new Date().toISOString();
    await store.insertTrace({
      trace_id: traceId,
      root_span_id: 'root',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: started,
      ended_at: ended,
      duration_ms: 250,
      tool_call_count: 0,
      cost_usd: 0,
    });

    const detail = await store.getTrace(traceId);
    expect(detail!.status).toBe('ok');
    expect(detail!.duration_ms).toBe(250);
  });

  it('lists traces with filters', async () => {
    await store.insertTrace({
      trace_id: 't1',
      root_span_id: 'r1',
      domain: 'APP',
      kind: 'http_request',
      status: 'ok',
      started_at: new Date().toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    });

    await store.insertTrace({
      trace_id: 't2',
      root_span_id: 'r2',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date().toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    });

    const all = await store.listTraces({ limit: 10 });
    expect(all).toHaveLength(2);

    const app = await store.listTraces({ domain: 'APP' });
    expect(app).toHaveLength(1);
    expect(app[0]!.trace_id).toBe('t1');
  });

  it('inserts and reads logs', async () => {
    const ts = new Date().toISOString();
    await store.insertLog({
      trace_id: 'trace-1',
      span_id: 'span-1',
      session_id: 'session-1',
      domain: 'AGENT',
      ts,
      level: 'info',
      scope: 'test',
      message: 'hello',
      payload: { extra: 1 },
    });

    const logs = await store.getLogs({ trace_id: 'trace-1' });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toBe('hello');
    expect(logs[0]!.payload).toEqual({ extra: 1 });
  });

  it('inserts and reads metric samples', async () => {
    const ts = new Date().toISOString();
    await store.insertMetricSamples([
      { ts, name: 'cpu', value: 0.5, labels: { domain: 'APP', host: 'a' } },
      { ts, name: 'cpu', value: 0.6, labels: { domain: 'APP', host: 'a' } },
    ]);

    const names = await store.listMetricNames('APP');
    expect(names).toContain('cpu');

    const series = await store.getMetricSeries('cpu', { domain: 'APP' }, new Date(Date.now() - 60000).toISOString(), new Date().toISOString(), 'minute');
    expect(series).toBeDefined();
    expect(series.name).toBe('cpu');
    expect(series.points.length).toBeGreaterThan(0);
  });

  it('purges old traces', async () => {
    await store.insertTrace({
      trace_id: 'old',
      root_span_id: 'r',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      ended_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    });

    await store.purgeOlderThan(1);
    const detail = await store.getTrace('old');
    expect(detail).toBeUndefined();
  });

  it('purgeOlderThan keeps recent traces', async () => {
    await store.insertTrace({
      trace_id: 'recent',
      root_span_id: 'r',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    });

    await store.purgeOlderThan(1);
    const detail = await store.getTrace('recent');
    expect(detail).toBeDefined();
  });

  it('purgeAll truncates all tables', async () => {
    await store.insertTrace({
      trace_id: 't1',
      root_span_id: 'r',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    });
    await store.insertLog({
      domain: 'AGENT',
      ts: new Date().toISOString(),
      level: 'info',
      message: 'test',
    });
    await store.insertMetricSamples([
      { ts: new Date().toISOString(), name: 'm', value: 1, labels: {} },
    ]);

    await store.purgeAll();
    const traces = await store.listTraces({});
    expect(traces.traces).toHaveLength(0);
  });

  it('getConfig / updateConfig round-trip', async () => {
    // Reset config to defaults.
    await pool.query('UPDATE observability.config SET retention_days = 30, capture_prompts = true, enabled = true WHERE id = 1');
    const initial = await store.getConfig();
    expect(initial).toBeDefined();
    expect(initial!.retention_days).toBe(30);

    const updated = await store.updateConfig({ retention_days: 7, capture_prompts: false });
    expect(updated).toBeDefined();
    expect(updated!.retention_days).toBe(7);
    expect(updated!.capture_prompts).toBe(false);

    const reread = await store.getConfig();
    expect(reread!.retention_days).toBe(7);
    expect(reread!.capture_prompts).toBe(false);

    // Restore.
    await store.updateConfig({ retention_days: 30, capture_prompts: true });
  });

  it('insertTrace redacts user_text when capture_prompts=false', async () => {
    await store.updateConfig({ capture_prompts: false });
    await store.insertTrace({
      trace_id: 'redact-test',
      root_span_id: 'r',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      user_text: 'my secret prompt',
      tool_call_count: 0,
      cost_usd: 0,
    });
    const detail = await store.getTrace('redact-test');
    expect(detail).toBeDefined();
    expect(detail!.user_text).toBe('[redacted:15]');
    // Restore.
    await store.updateConfig({ capture_prompts: true });
  });

  it('swallows write errors (simulated pg failure)', async () => {
    // Create a store with a mock pool that throws.
    const badPool = {
      query: () => { throw new Error('pg connection lost'); },
      on: () => {},
    } as unknown as Pool;
    const badStore = new ObservabilityStore(badPool);
    // Should NOT throw — observability writes are non-blocking.
    await expect(badStore.insertTrace({
      trace_id: 'fail',
      root_span_id: 'r',
      domain: 'AGENT',
      kind: 'turn',
      status: 'ok',
      started_at: new Date().toISOString(),
      tool_call_count: 0,
      cost_usd: 0,
    })).resolves.toBeUndefined();
  });
});
