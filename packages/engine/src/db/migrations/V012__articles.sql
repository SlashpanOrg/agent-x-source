-- Articles sidebar product. Replaces the unused `markdowns` table from V003.
-- No row or filesystem migration — this is a new module.

DROP TABLE IF EXISTS markdowns CASCADE;

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'article',
  source_role TEXT,
  compile_error TEXT,
  list_day_key TEXT,
  list_day_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_session ON articles(session_id, created_at DESC);
