-- Automation, notifications, markdown documents, knowledge base, pgvector,
-- voice realtime state, document templates, and document studio.

-- ─── Automation tasks ───────────────────────────────────────────────────────

CREATE TABLE automation_tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT,
  display_id TEXT,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
  cron_expression TEXT,
  run_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',
  source_channel TEXT NOT NULL DEFAULT 'web',
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  notify_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  permission_snapshot JSONB,
  pgboss_job_id TEXT,
  pgboss_schedule_name TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_tasks_status ON automation_tasks(status);
CREATE INDEX idx_automation_tasks_session ON automation_tasks(source_session_id);
CREATE UNIQUE INDEX idx_automation_tasks_active_key ON automation_tasks(task_key) WHERE task_key IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX idx_automation_tasks_display_id ON automation_tasks(display_id) WHERE display_id IS NOT NULL;

CREATE TABLE automation_run_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  level TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  event_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_run_logs_task_created ON automation_run_logs(task_id, created_at);
CREATE INDEX idx_automation_run_logs_run ON automation_run_logs(run_id, created_at);

CREATE TABLE automation_session_confirmations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmation_note TEXT
);

-- ─── Notifications ──────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES automation_tasks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB,
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  delivery_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_notifications_active ON notifications(created_at DESC) WHERE dismissed_at IS NULL;

-- ─── Markdown documents ─────────────────────────────────────────────────────

CREATE TABLE markdowns (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  source_role TEXT,
  compile_error TEXT,
  list_day_key TEXT,
  list_day_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_markdowns_created ON markdowns(created_at DESC);
CREATE INDEX idx_markdowns_session ON markdowns(session_id, created_at DESC);

-- ─── Knowledge base ─────────────────────────────────────────────────────────

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary TEXT,
  chunk_count INTEGER,
  page_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_sources_session ON knowledge_sources(session_id);
CREATE INDEX idx_knowledge_sources_status ON knowledge_sources(status);
CREATE INDEX idx_knowledge_sources_created_at ON knowledge_sources(created_at DESC);

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, index)
);

CREATE INDEX idx_knowledge_chunks_source ON knowledge_chunks(source_id);
CREATE INDEX idx_knowledge_chunks_source_index ON knowledge_chunks(source_id, index);

CREATE TABLE knowledge_pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  embedding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, page_number)
);

CREATE INDEX idx_knowledge_pages_source ON knowledge_pages(source_id);

CREATE TABLE knowledge_source_status_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_status_events_source ON knowledge_source_status_events(source_id);

-- ─── pgvector (optional — app degrades to in-memory store if unavailable) ──

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE knowledge_chunk_vectors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      embedding vector(1536)
    );
    CREATE INDEX idx_knowledge_chunk_vectors_source ON knowledge_chunk_vectors(source_id);
    CREATE INDEX idx_knowledge_chunk_vectors_embedding ON knowledge_chunk_vectors USING ivfflat (embedding vector_cosine_ops);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- ─── Voice realtime state ───────────────────────────────────────────────────

CREATE TABLE voice_realtime_state (
  session_id TEXT PRIMARY KEY,
  xai_conversation_id TEXT,
  xai_conversation_updated_at TIMESTAMPTZ,
  last_voice_active_at TIMESTAMPTZ,
  summary TEXT,
  summary_updated_at TIMESTAMPTZ,
  summary_source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voice_realtime_last_active ON voice_realtime_state (last_voice_active_at DESC NULLS LAST);

-- ─── Document templates ─────────────────────────────────────────────────────

CREATE TABLE document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'other',
  fillable BOOLEAN NOT NULL DEFAULT FALSE,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  analysis_status TEXT NOT NULL DEFAULT 'ready',
  analysis_error TEXT,
  design_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_templates_name ON document_templates (name);
CREATE INDEX idx_document_templates_updated ON document_templates (updated_at DESC);

-- ─── Document Studio ────────────────────────────────────────────────────────

CREATE TABLE doc_masters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'layout',
  format TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  analysis JSONB,
  analysis_state TEXT NOT NULL DEFAULT 'pending',
  analysis_error TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_masters_kind ON doc_masters (kind);
CREATE INDEX idx_doc_masters_updated ON doc_masters (updated_at DESC);

CREATE TABLE doc_binders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_binders_name ON doc_binders (name);

CREATE TABLE doc_answer_sets (
  id TEXT PRIMARY KEY,
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE doc_mappings (
  id TEXT PRIMARY KEY,
  data_master_id TEXT NOT NULL,
  schema_ref TEXT NOT NULL,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE doc_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  spec JSONB NOT NULL,
  recipe_id TEXT,
  binder_id TEXT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_detail TEXT,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  manifest_id TEXT,
  step_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_jobs_status ON doc_jobs (status);
CREATE INDEX idx_doc_jobs_updated ON doc_jobs (updated_at DESC);

CREATE TABLE doc_instances (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  index INTEGER NOT NULL,
  binding_set_id TEXT,
  path TEXT,
  master_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  error TEXT
);

CREATE INDEX idx_doc_instances_job ON doc_instances (job_id);

CREATE TABLE doc_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  instance_index INTEGER,
  path TEXT NOT NULL,
  storage_id TEXT,
  format TEXT NOT NULL,
  checksum TEXT NOT NULL,
  binding_set_id TEXT,
  evidence_map JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_artifacts_job ON doc_artifacts (job_id);

CREATE TABLE doc_manifests (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_ok INTEGER NOT NULL DEFAULT 0,
  summary_failed INTEGER NOT NULL DEFAULT 0,
  summary_skipped INTEGER NOT NULL DEFAULT 0
);
