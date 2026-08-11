# Database Migrations

This directory contains versioned SQL migration files that are applied to the
PostgreSQL database on app startup. The migration system is forward-only —
migrations are never rolled back, only new ones are added.

## How it works

1. **SQL files** live in this directory with the naming convention:
   ```
   V001__descriptive_name.sql
   V002__add_column_xyz.sql
   ```
   The version number (`V001`, `V002`, ...) determines execution order.

2. **Build time**: `scripts/generate-migration-registry.mjs` reads all `.sql`
   files and generates `src/db/migration-registry.ts` with the SQL content
   embedded as string literals. This runs automatically before `tsup` via
   the `prebuild` script in `package.json`.

3. **Runtime**: `runMigrations()` from `MigrationRunner.ts`:
   - Creates a `core_schema_migrations` tracking table if it doesn't exist
   - Acquires a PostgreSQL advisory lock to prevent concurrent migration runs
   - Queries which migrations are already applied
   - Executes only the pending migrations, each in its own transaction
   - Records each applied migration in `core_schema_migrations`

## Current state

The migrations were squashed into 5 domain-organized files (from the original
27 incremental migrations). Since there are no production users, the entire
schema history was collapsed into a clean baseline reflecting the final state
of all tables — no `ALTER TABLE` corrections or rename migrations.

- **V001__core** — Sessions, messages, crews, tokens, tasks, events, persona,
  emotions, memories, skills, credentials, background tasks
- **V002__crew_catalog** — Crew Hub catalog, app metadata, session preferences
- **V003__automation_markdown_kb** — Automation, notifications, markdown docs,
  knowledge base, pgvector, voice state, document templates, document studio
- **V004__whatsapp** — WhatsApp channel tables
- **V005__observability** — Observability schema (traces, spans, logs, metrics,
  OTLP, alerting, cost analytics)
- **V006__prime_adoption** — Harness, goals, durable turns, session leases,
  command journal, inter-agent messaging, resident sessions

## Adding a new migration

1. Create a new SQL file with the next version number:
   ```
   V006__add_new_feature_table.sql
   ```

2. Write the SQL using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS` for idempotency.

3. Rebuild the engine:
   ```
   pnpm --filter @agentx/engine build
   ```
   The `prebuild` script will regenerate the migration registry automatically.

4. The migration will be applied on the next app startup.

## Rules

- **Never edit an existing migration file** — once applied to any database,
  its content is immutable. Create a new migration instead.
- **Always use `IF NOT EXISTS`** — makes the SQL idempotent even if retried.
- **Version numbers must be sequential** — gaps are allowed but discouraged.
- **One concern per migration** — don't mix unrelated schema changes in the
  same file. Create separate files for separate features.
