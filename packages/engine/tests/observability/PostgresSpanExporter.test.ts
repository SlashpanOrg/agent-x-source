import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ObservabilityStore } from '../../src/observability/ObservabilityStore.js';
import { PostgresSpanExporter } from '../../src/observability/PostgresSpanExporter.js';
import type { ReadableSpan } from '@opentelemetry/sdk-node';
import { ExportResultCode } from '@opentelemetry/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.AGENTX_TEST_PG ?? 'postgresql://agentx:agentx@127.0.0.1:3335/agentx';

async function isPgAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
  try { await pool.query('SELECT 1'); return true; } catch { return false; } finally { await pool.end(); }
}

function makeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return {
    name: 'test.span',
    kind: 0,
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
    parentSpanId: undefined,
    startTime: [0, 0],
    endTime: [0, 1000000],
    ended: true,
    attributes: {},
    status: { code: 0 },
    events: [],
    links: [],
    duration: [0, 1],
    resource: { attributes: {} } as never,
    instrumentationLibrary: { name: 'test' } as never,
    ...overrides,
  } as unknown as ReadableSpan;
}

describe.runIf(await isPgAvailable())('PostgresSpanExporter', () => {
  let pool: Pool;
  let store: ObservabilityStore;
  let exporter: PostgresSpanExporter;

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
    await pool.query('UPDATE observability.config SET capture_prompts = true WHERE id = 1');
    exporter = new PostgresSpanExporter(store, { ringBufferSize: 100, getCapturePrompts: () => true });
  });

  it('exports a batch of spans and inserts rows', async () => {
    const span = makeSpan({
      name: 'llm.chat',
      attributes: { 'gen_ai.system': 'openai', 'gen_ai.request.model': 'gpt-4' },
    });
    await new Promise<void>((resolve) => {
      exporter.export([span], (result) => {
        expect(result.code).toBe(ExportResultCode.SUCCESS);
        resolve();
      });
    });
    await exporter.shutdown();
    // Verify spans were inserted.
    const { rows } = await pool.query('SELECT name FROM observability.spans WHERE name = $1', ['llm.chat']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('redacts prompt attributes when capturePrompts=false', async () => {
    exporter = new PostgresSpanExporter(store, { ringBufferSize: 100, getCapturePrompts: () => false });
    const span = makeSpan({
      name: 'llm.chat',
      attributes: {
        'llm.input_messages': [{ role: 'user', content: 'secret' }],
        'gen_ai.usage.input_tokens': 100,
      },
    });
    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });
    await exporter.shutdown();
    const { rows } = await pool.query("SELECT attributes FROM observability.spans WHERE name = 'llm.chat' LIMIT 1");
    const attrs = rows[0]!.attributes as Record<string, unknown>;
    expect(attrs['llm.input_messages']).toBe('[redacted:36]');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(100);
  });

  it('backpressure: overflow ring buffer increments dropped counter', async () => {
    exporter = new PostgresSpanExporter(store, { ringBufferSize: 5, getCapturePrompts: () => true });
    // Export 20 spans rapidly — the ring buffer (size 5) will overflow.
    const spans = Array.from({ length: 20 }, (_, i) => makeSpan({
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: String(i).padStart(16, '0'), traceFlags: 1 }),
      name: `span.${i}`,
    }));
    await new Promise<void>((resolve) => {
      exporter.export(spans, () => resolve());
    });
    // Some spans should have been dropped.
    expect(exporter.droppedCount).toBeGreaterThan(0);
    await exporter.shutdown();
  });

  it('shutdown flushes remaining spans', async () => {
    const span = makeSpan({ name: 'flush.test' });
    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });
    await exporter.shutdown();
    const { rows } = await pool.query("SELECT name FROM observability.spans WHERE name = 'flush.test'");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('PostgresSpanExporter (unit, no PG)', () => {
  it('export after shutdown returns SUCCESS without inserting', () => {
    const mockStore = { insertSpan: vi.fn(), insertTrace: vi.fn().mockResolvedValue(true), insertSpans: vi.fn() } as unknown as ObservabilityStore;
    const exporter = new PostgresSpanExporter(mockStore, { ringBufferSize: 10 });
    // Simulate shutdown.
    exporter.shutdown();
    const span = makeSpan();
    exporter.export([span], (result) => {
      expect(result.code).toBe(ExportResultCode.SUCCESS);
    });
    expect(mockStore.insertSpan).not.toHaveBeenCalled();
  });
});
