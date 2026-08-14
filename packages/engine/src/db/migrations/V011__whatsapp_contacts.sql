-- Owner WhatsApp address book. Structured index (not RAG) so name → JID
-- resolution is deterministic: unique match or ask, never a fuzzy guess.

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  jid TEXT PRIMARY KEY,
  phone TEXT,
  lid_jid TEXT,
  saved_name TEXT,
  first_name TEXT,
  last_name TEXT,
  notify_name TEXT,
  business_name TEXT,
  username TEXT,
  is_saved BOOLEAN NOT NULL DEFAULT FALSE,
  sendable BOOLEAN NOT NULL DEFAULT TRUE,
  aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
  search_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_phone
  ON whatsapp_contacts(phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_saved_name
  ON whatsapp_contacts(lower(saved_name));

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_business_name
  ON whatsapp_contacts(lower(business_name));

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_search
  ON whatsapp_contacts(search_text);
