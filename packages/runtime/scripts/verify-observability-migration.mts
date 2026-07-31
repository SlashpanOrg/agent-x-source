#!/usr/bin/env tsx
/**
 * Standalone Phase-1 verification (tsx version): starts embedded Postgres,
 * runs all engine migrations (including V024 observability), verifies the
 * observability schema, then re-runs migrations to confirm idempotency.
 *
 * Imports MigrationRunner + migration-registry directly from engine SRC to
 * avoid loading the full engine bundle (which pulls in whatsapp-web.js and
 * breaks under plain Node ESM interop).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Runtime is CJS-only in exports; load via require.
const { PostgresLifecycleManager, resolveDefaultServerDataDir } = require('@agentx/runtime');

// Engine migration pieces — imported from SRC (no whatsapp-web.js in this graph).
const { runMigrations } = await import(join(__dirname, '..', '..', 'engine', 'src', 'db', 'MigrationRunner.ts'));
const { MIGRATION_FILES } = await import(join(__dirname, '..', '..', 'engine', 'src', 'db', 'migration-registry.ts'));

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

async function main() {
  console.log('Starting embedded Postgres on 3335...');
  const connStr = await pg.start();
  console.log('PG started:', connStr);

  const pool = new Pool({ connectionString: connStr, max: 2 });

  console.log('\n=== Migration run #1 (fresh) ===');
  const r1 = await runMigrations(pool, MIGRATION_FILES);
  console.log(`applied=${r1.applied} skipped=${r1.skipped} currentVersion=${r1.currentVersion}`);
  const v024 = r1.appliedMigrations.find((m) => m.name.includes('observability_schema'));
  console.log('V024 applied:', v024 ? `yes (v${v024.version})` : 'no');

  console.log('\n=== Verify observability schema objects ===');
  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'observability' ORDER BY table_name
  `);
  console.log('Tables:', tables.map((r) => r.table_name).join(', '));

  const { rows: idx } = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'observability' ORDER BY indexname
  `);
  console.log(`Indexes (${idx.length}):`, idx.map((r) => r.indexname).join(', '));

  const { rows: cfg } = await pool.query('SELECT retention_days, capture_prompts, enabled FROM observability.config WHERE id = 1');
  console.log('Config row:', cfg[0]);

  const expectedTables = ['config', 'logs', 'metric_samples', 'spans', 'traces'];
  const gotTables = tables.map((r) => r.table_name);
  const missing = expectedTables.filter((t) => !gotTables.includes(t));
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
  if (!v024) throw new Error('V024 was not applied on fresh DB');
  if (idx.length < 10) throw new Error(`Expected >=10 indexes, got ${idx.length}`);

  console.log('\n=== Migration run #2 (idempotency) ===');
  const r2 = await runMigrations(pool, MIGRATION_FILES);
  console.log(`applied=${r2.applied} skipped=${r2.skipped} currentVersion=${r2.currentVersion}`);
  if (r2.applied !== 0) throw new Error(`Idempotency failed: ${r2.applied} migrations re-applied`);

  const { rows: rec } = await pool.query('SELECT version FROM core_schema_migrations WHERE name LIKE $1', ['%observability_schema%']);
  if (rec.length !== 1) throw new Error(`Expected 1 V024 record, got ${rec.length}`);

  console.log('\n✅ Phase-1 verification PASSED: V024 applies on fresh PG, schema/tables/indexes exist, re-run is idempotent.');
  await pool.end();
}

main()
  .catch((err) => {
    console.error('❌ Phase-1 verification FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pg.stop(); } catch { /* ignore */ }
  });
