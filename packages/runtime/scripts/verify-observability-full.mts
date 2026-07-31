#!/usr/bin/env tsx
/**
 * Node runtime verifier for the Agent-X observability stack.
 *
 * Replaces the bash verify-observability.sh with a single TypeScript script that:
 *   - starts an embedded Postgres
 *   - runs DB migrations
 *   - verifies span → trace → log → metric_samples persistence
 *   - verifies HTTP parent → agent.turn child cross-domain nesting
 *   - verifies capture_prompts=false redaction
 *   - verifies OTLP exporter config persistence and wiring
 *   - runs the retention purger
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
const {
  initObservability,
  shutdownObservability,
  withSpan,
  startAppSpan,
  ObservabilityStore,
} = await import(join(__dirname, '..', '..', 'engine', 'src', 'observability', 'index.ts'));

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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Starting embedded Postgres on 3335...');
  const connStr = await pg.start();
  const pool = new Pool({ connectionString: connStr, max: 2 });
  await runMigrations(pool, MIGRATION_FILES);
  await pool.query(
    'TRUNCATE observability.spans, observability.logs, observability.metric_samples, observability.traces, observability.config RESTART IDENTITY CASCADE',
  );

  // Seed a config row before initObservability so it reads otlp_enabled=true.
  await pool.query(
    `INSERT INTO observability.config (id, retention_days, capture_prompts, enabled, otlp_enabled, otlp_endpoint, otlp_protocol, otlp_headers, alerting_enabled, alerting_error_rate_pct, alerting_latency_p95_ms, alerting_window_minutes)
     VALUES (1, 30, true, true, true, 'http://127.0.0.1:9999/v1/traces', 'http', '{}', false, 10, 30000, 15)
     ON CONFLICT (id) DO NOTHING`,
  );
  console.log('Migrations applied. Observability tables truncated.');

  const metricSources = [
    { name: 'verify-dummy', snapshot: () => [{ name: 'verify.dummy', value: 1, labels: { domain: 'APP' } }] },
  ];

  console.log('\n=== initObservability with OTLP enabled ===');
  const handle = await initObservability(pool, { metricSources });
  console.log('isEnabled:', handle.isEnabled());
  const startupConfig = await handle.store.getConfig();
  assert(startupConfig?.otlp_enabled === true, 'OTLP config not persisted/read correctly');
  console.log('  OTLP config read on init:', startupConfig.otlp_enabled, startupConfig.otlp_endpoint);

  // ── Phase 2: basic span / log / metric wiring ─────────────────────────────
  console.log('\n=== Phase 2: basic span, log, metrics ===');
  withSpan('test.span', 'internal', (span) => {
    span.setAttribute('test', true);
    span.setAttribute('session.id', 'sess-test');
    span.setAttribute('trace.kind', 'turn');
    handle.logExporter.emit({
      level: 'info',
      scope: 'verify',
      message: 'hello from phase-2 verify',
      payload: { ok: true },
    });
    return 42;
  });

  console.log('Waiting for batch flush (7s)...');
  await sleep(7000);

  const { rows: spanRows } = await pool.query(
    "SELECT * FROM observability.spans WHERE name = 'test.span' ORDER BY started_at DESC LIMIT 1",
  );
  assert(spanRows.length > 0, 'test span did not land in observability.spans');
  const traceId = spanRows[0].trace_id;
  console.log('  span ok — trace_id:', traceId);

  const { rows: traceRows } = await pool.query('SELECT * FROM observability.traces WHERE trace_id = $1', [traceId]);
  assert(traceRows.length > 0, 'root trace row not upserted');

  await handle.logExporter.flush();
  const { rows: logRows } = await pool.query("SELECT * FROM observability.logs WHERE message LIKE '%phase-2 verify%'");
  assert(logRows.length > 0, 'test log did not land in observability.logs');
  assert(logRows[0].trace_id === traceId, 'log trace_id mismatch (context not captured)');
  console.log('  log context ok');

  await handle.metricsSampler.sample();
  const { rows: metricRows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM observability.metric_samples WHERE name = 'verify.dummy'",
  );
  assert(metricRows[0].n > 0, 'metrics sampler did not write rows');
  console.log('  metrics sampler ok');

  // ── Retention purger ──────────────────────────────────────────────────────
  console.log('\n=== Retention purger ===');
  const oldIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO observability.traces (trace_id, root_span_id, domain, kind, status, started_at, ended_at, duration_ms, tool_call_count, cost_usd)
     VALUES ('trace-old','span-old','AGENT','turn','ok',$1,$1,10,0,0) ON CONFLICT DO NOTHING`,
    [oldIso],
  );
  await handle.store.updateConfig({ retention_days: 1 });
  await handle.retentionPurger.runOnce();
  const { rows: oldAfter } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM observability.traces WHERE trace_id = 'trace-old'",
  );
  assert(oldAfter[0].n === 0, 'retention purge did not delete the old trace');
  const { rows: keepAfter } = await pool.query('SELECT COUNT(*)::int AS n FROM observability.traces');
  assert(keepAfter[0].n > 0, 'retention purge deleted recent traces too');
  console.log('  retention purger ok');

  // ── P1: cross-domain nesting (HTTP parent → agent.turn child) ──────────────
  console.log('\n=== P1: cross-domain nesting (HTTP parent → agent.turn child) ===');
  let httpTraceId = '';
  let httpSpanId = '';
  let turnSpanId = '';
  let turnTraceId = '';

  await withSpan(
    'http POST /api/chat/message',
    'http',
    (httpSpan) => {
      httpSpanId = httpSpan.spanContext().spanId;
      httpTraceId = httpSpan.spanContext().traceId;
      return withSpan(
        'agent.turn',
        'agent',
        (span) => {
          turnSpanId = span.spanContext().spanId;
          turnTraceId = span.spanContext().traceId;
        },
        { 'trace.kind': 'turn', 'session.id': 'sess-cross', 'turn.id': 'turn-cross' },
      );
    },
    {
      'trace.kind': 'http_request',
      'http.method': 'POST',
      'http.route': '/api/chat/message',
      'http.url': '/api/chat/message',
      'trace.domain': 'APP',
    },
  );

  console.log('Waiting for span batch flush (10s)...');
  await sleep(10000);

  const { rows: httpTraceDebug } = await pool.query('SELECT * FROM observability.traces WHERE trace_id = $1', [httpTraceId]);
  const { rows: httpSpanDebug } = await pool.query('SELECT name, span_id, parent_span_id, trace_id FROM observability.spans WHERE trace_id = $1', [httpTraceId]);
  console.log('  http trace row count:', httpTraceDebug.length);
  console.log('  http trace spans:', httpSpanDebug);

  const { rows: httpRows } = await pool.query(
    "SELECT * FROM observability.spans WHERE name = 'http POST /api/chat/message' ORDER BY started_at DESC LIMIT 1",
  );
  assert(httpRows.length > 0, 'HTTP span did not land in observability.spans');
  const httpRow = httpRows[0];

  const { rows: turnRows } = await pool.query(
    "SELECT * FROM observability.spans WHERE name = 'agent.turn' ORDER BY started_at DESC LIMIT 1",
  );
  assert(turnRows.length > 0, 'agent.turn span did not land in observability.spans');
  const turnRow = turnRows[0];

  assert(
    httpRow.trace_id === turnRow.trace_id,
    `trace_id mismatch: HTTP ${httpRow.trace_id} vs turn ${turnRow.trace_id}`,
  );
  assert(
    turnRow.parent_span_id === httpRow.span_id,
    `parent_id mismatch: turn parent ${turnRow.parent_span_id} vs HTTP span ${httpRow.span_id}`,
  );
  console.log('  HTTP parent → agent.turn child ok');

  // ── P2: capture_prompts=false redaction ──────────────────────────────────
  console.log('\n=== P2: capture_prompts=false redaction ===');
  await handle.store.updateConfig({ capture_prompts: false });
  await handle.reloadConfig();

  withSpan(
    'llm.redact',
    'llm',
    (span) => {
      span.setAttribute('gen_ai.system', 'test');
      span.setAttribute('gen_ai.request.model', 'test-model');
      span.setAttribute('llm.input_messages', 'super secret prompt');
      span.setAttribute('llm.output_messages', 'super secret output');
      span.setAttribute('user.text', 'secret user query');
    },
    { 'trace.kind': 'llm' },
  );

  console.log('Waiting for span batch flush (10s)...');
  await sleep(10000);

  const { rows: redactRows } = await pool.query(
    "SELECT * FROM observability.spans WHERE name = 'llm.redact' ORDER BY started_at DESC LIMIT 1",
  );
  assert(redactRows.length > 0, 'redaction test span did not land');
  const attrs = redactRows[0].attributes as Record<string, unknown>;
  assert(
    String(attrs['llm.input_messages']).startsWith('[redacted:'),
    `llm.input_messages not redacted: ${attrs['llm.input_messages']}`,
  );
  assert(
    String(attrs['llm.output_messages']).startsWith('[redacted:'),
    `llm.output_messages not redacted: ${attrs['llm.output_messages']}`,
  );
  assert(
    String(attrs['user.text']).startsWith('[redacted:'),
    `user.text not redacted: ${attrs['user.text']}`,
  );
  console.log('  capture_prompts=false redaction ok');

  // ── P2: OTLP exporter config wiring / resilience ───────────────────────────
  console.log('\n=== P2: OTLP exporter wiring ===');
  withSpan('otlp.wire', 'internal', (span) => {
    span.setAttribute('test', 'otlp');
  });

  console.log('Waiting for span batch flush (10s)...');
  await sleep(10000);

  const { rows: otlpRows } = await pool.query(
    "SELECT * FROM observability.spans WHERE name = 'otlp.wire' ORDER BY started_at DESC LIMIT 1",
  );
  assert(
    otlpRows.length > 0,
    'OTLP wiring test span did not land locally (OTLP init should not break local persistence)',
  );
  console.log('  OTLP wiring ok (local span persisted despite missing collector)');

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\n=== Cleanup ===');
  await shutdownObservability();
  await sleep(1000);
  await pool.end();
  console.log('\n✅ Full observability runtime verification PASSED.');
}

main()
  .catch((err) => {
    console.error('\n❌ Full observability runtime verification FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
  });
