-- Rebirth Online — Chatbot human handoff (Cloudflare D1)
-- ==================================================================
-- Adds the pieces the Telegram handoff + polling loop need on top of
-- migration 0001:
--   * sessions.escalated_at — the server-side anchor for the escalation
--     timeout ("Alex hasn't replied in N minutes → show the contact fallback").
--   * an (session_id, id) index — the polling loop keys on the monotonic
--     message id, not created_at (which is only whole-second resolution and
--     would drop same-second messages).
--
-- Applied with Wrangler:  npx wrangler d1 migrations apply rebirth-chat
-- (add --local for the miniflare store used by `npm run dev`).
-- ==================================================================

-- When the session transitioned to `escalated` (unix epoch seconds, nullable).
ALTER TABLE sessions ADD COLUMN escalated_at INTEGER;

-- The handoff poll query is `WHERE session_id = ? AND id > ? ORDER BY id ASC`.
CREATE INDEX IF NOT EXISTS idx_messages_session_id
  ON messages (session_id, id);
