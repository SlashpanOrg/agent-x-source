-- WhatsApp channel: single-session lifecycle, Baileys credential storage, message log,
-- LID<->phone identity mapping, and external webhook subsystem.
--
-- Scope note: exactly one WhatsApp session is supported per Agent-X install (see
-- WHATSAPP_INTEGRATION_PLAN.md Ground Rule 7). whatsapp_session is single-row by
-- application convention, not a hard schema constraint, so this isn't artificially
-- welded shut if that changes later.

-- ---------------------------------------------------------------------------
-- 1.1 Session lifecycle record (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_session (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'disconnected',
  engine TEXT NOT NULL DEFAULT 'baileys',
  phone_number TEXT,
  push_name TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 1.2 Baileys credential storage.
--
-- Baileys' AuthenticationState splits into two independently-shaped parts:
--   - `creds`: a single AuthenticationCreds object (noise/identity/signed-prekey
--     material, registration id, account info) that changes occasionally.
--   - `keys`: a signal protocol key store accessed via get(category, ids) /
--     set({ [category]: { [id]: value | null } }), mutated frequently (one row
--     read/write per key, not a full-blob rewrite) as messages are sent/received.
--
-- Modeling `keys` as individual rows (rather than one growing JSON blob) avoids
-- read-modify-write races and avoids re-encrypting/re-writing an ever-growing
-- blob on every single message.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_creds (
  id TEXT PRIMARY KEY DEFAULT 'default',
  creds_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_signal_keys (
  category TEXT NOT NULL,
  key_id TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, key_id)
);

-- ---------------------------------------------------------------------------
-- 1.3 LID <-> phone number mapping (WhatsApp multi-device identity quirk;
-- global/last-write-wins, independent of session count).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_lid_mapping (
  lid TEXT PRIMARY KEY,
  phone TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 1.4 Message log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'incoming' | 'outgoing'
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|delivered|read|failed
  timestamp BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id ON whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_id, timestamp);

-- ---------------------------------------------------------------------------
-- 1.5 External webhook subscriptions (managed exclusively through agent tools,
-- not REST CRUD — see Phase 6/7 of the plan).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['*']::text[],
  secret_enc TEXT,
  secret_iv TEXT,
  secret_tag TEXT,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  filters JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  retry_count INTEGER NOT NULL DEFAULT 3,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 1.6 Webhook delivery failure / dead-letter bookkeeping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_webhook_failures (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES whatsapp_webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_failures_webhook ON whatsapp_webhook_failures(webhook_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_failures_created ON whatsapp_webhook_failures(created_at);
