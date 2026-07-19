-- Rebirth Online — Chatbot conversation memory (Cloudflare D1)
-- ==================================================================
-- Persistent store for chat sessions and their message transcripts.
-- Applied with Wrangler:  npx wrangler d1 migrations apply <db-name>
-- (add --local for the miniflare store used by `npm run dev`).
--
-- This is the foundation for later work (model failsafe, human/Telegram
-- handoff); the `status` column and the `human`/`system` message roles exist
-- so those steps don't need a second migration.
-- ==================================================================

-- One row per visitor conversation.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,             -- uuid (crypto.randomUUID)
  status          TEXT NOT NULL DEFAULT 'ai_active', -- ai_active | escalated | human_active | closed
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()), -- unix epoch seconds
  visitor_contact TEXT                          -- email/phone once shared (nullable)
);

-- Every turn in a conversation, oldest to newest.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  role        TEXT NOT NULL,                    -- visitor | ai | human | system
  content     TEXT NOT NULL,
  model_used  TEXT,                             -- OpenRouter model id for `ai` rows (nullable)
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()) -- unix epoch seconds
);

-- History reads always filter by session and order by time, so index both.
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages (session_id, created_at);
