-- WhatsApp Jarvis: owner standing orders (when to brief / auto-reply / ignore).

CREATE TABLE IF NOT EXISTS whatsapp_standing_orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_json JSONB NOT NULL DEFAULT '{"type":"brief"}'::jsonb,
  created_from TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_standing_orders_enabled
  ON whatsapp_standing_orders(enabled, priority DESC, created_at ASC);
