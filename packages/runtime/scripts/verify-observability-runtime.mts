#!/usr/bin/env tsx
/**
 * Phase-2 runtime verification: starts embedded Postgres, runs migrations,
 * inits observability, creates a span, emits a log, samples metrics, runs the
 * retention purger, and verifies each artifact lands in the observability schema.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const { PostgresLifecycleManager, resolveDefaultServerDataDir } = require('@agentx/runtime');
const { runMigrations } = await import(join(__dirname, '..', '..', 'engine', 'src', 'db', 'MigrationRunner.ts'));
const { MIGRATION_FILES } = await import(join(__dirname, '..', '..', 'engine', 'src', 'db', 'migration-registry.ts'));
const { initObservability, shutdownObservability, withSpan } = await import(join(__dirname, '..', '..', 'engine', 'src', 'observability', 'index.ts'));

const dataDir = resolveDefaultServerDataDir();
mkdirSync(dataDir, { recursive: true });
const pgDataDir = join(dataDir, 'brain_db');

const pg = new PostgresLifecycleManager({
  dataDir: pgDataDir,
  port: 3335,
  host: '127.0.0.1',
  user: 'agentx',
  password: 'agentx',
  database: 'agentx',
  onLog: (m: string) => console.log('[pg]', m),
  onWarn: (m: string) => console.warn('[pg]', m),
  onError: (m: string) => console.error('[pg]', m),
});

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('Starting embedded Postgres on 3335...');
  const connStr = await pg.start();
  const pool = new Pool({ connectionString: connStr, max: 2 });
  await runMigrations(pool, MIGRATION_FILES);
  await pool.query('TRUNCATE observability.spans, observability.logs, observability.metric_samples, observability.traces RESTART IDENTITY CASCADE');
  console.log('Migrations applied. Observability tables truncated.');

  console.log('\n=== initObservability ===');
  const handle = await initObservability(pool, {
    metricSources: [
      { name: 'verify-dummy', snapshot: () => [{ name: 'verify.dummy', value: 1, labels: { domain: 'APP' } }] },
    ],
  });
  console.log('isEnabled:', handle.isEnabled());

  console.log('\n=== Create a test span + emit a log inside it ===');
  withSpan('test.span', 'internal', (span) => {
    span.setAttribute('test', true);
    span.setAttribute('session.id', 'sess-test');
    span.setAttribute('trace.kind', 'turn');
    // Emit the log INSIDE the span so the log captures the active trace/span context.
    handle.logExporter.emit({ level: 'info', scope: 'verify', message: 'hello from phase-2 verify', payload: { ok: true } });
    return 42;
  });

  console.log('Waiting for batch flush (7s)...');
  await sleep(7000);

  const { rows: spanRows } = await pool.query("SELECT * FROM observability.spans WHERE name = 'test.span' ORDER BY started_at DESC LIMIT 1");
  console.log('span rows:', spanRows.length);
  if (spanRows.length === 0) throw new Error('test span did not land in observability.spans');
  const traceId = spanRows[0].trace_id;
  console.log('trace_id:', traceId);

  const { rows: traceRows } = await pool.query('SELECT * FROM observability.traces WHERE trace_id = $1', [traceId]);
  console.log('trace rows:', traceRows.length);
  if (traceRows.length === 0) throw new Error('root trace row not upserted');

  await handle.logExporter.flush();
  const { rows: logRows } = await pool.query("SELECT * FROM observability.logs WHERE message LIKE '%phase-2 verify%'");
  console.log('log rows:', logRows.length);
  if (logRows.length === 0) throw new Error('test log did not land in observability.logs');
  if (logRows[0].trace_id !== traceId) throw new Error('log trace_id mismatch (context not captured)');

  console.log('\n=== Metrics sampler ===');
  await handle.metricsSampler.sample();
  const { rows: metricRows } = await pool.query("SELECT COUNT(*)::int AS n FROM observability.metric_samples WHERE name = 'verify.dummy'");
  console.log('metric_samples rows:', metricRows[0].n);
  if (metricRows[0].n === 0) throw new Error('metrics sampler did not write rows');

  console.log('\n=== Retention purger (retention_days=1 should delete the old trace) ===');
  // Insert an old trace (ended 3 days ago) that retention_days=1 should purge.
  const oldIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO observability.traces (trace_id, root_span_id, domain, kind, status, started_at, ended_at, duration_ms, tool_call_count, cost_usd)
     VALUES ('trace-old','span-old','AGENT','turn','ok',$1,$1,10,0,0) ON CONFLICT DO NOTHING`,
    [oldIso],
  );
  await pool.query('UPDATE observability.config SET retention_days = 1');
  await handle.retentionPurger.runOnce();
  const { rows: oldAfter } = await pool.query("SELECT COUNT(*)::int AS n FROM observability.traces WHERE trace_id = 'trace-old'");
  console.log('old trace rows after purge:', oldAfter[0].n);
  if (oldAfter[0].n !== 0) throw new Error('retention purge with days=1 did not delete the old trace');
  const { rows: keepAfter } = await pool.query('SELECT COUNT(*)::int AS n FROM observability.traces WHERE trace_id <> $1', ['trace-old']);
  console.log('recent traces kept:', keepAfter[0].n);
  if (keepAfter[0].n === 0) throw new Error('retention purge deleted recent traces too');

  console.log('\n=== shutdownObservability ===');
  await shutdownObservability();
  await pool.end();

  console.log('\n✅ Phase-2 runtime verification PASSED.');
}

main()
  .catch((err) => { console.error('❌ Phase-2 verification FAILED:', err); process.exitCode = 1; })
  .finally(async () => { try { await pg.stop(); } catch { /* ignore */ } });
