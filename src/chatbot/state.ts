/**
 * Astro Motors — Chatbot State Layer (Cloudflare D1)
 * ==================================================================
 * The read/write layer for persistent conversation memory. Kept fully
 * isolated from `core.ts` so the storage backend is swappable later and so
 * `core.ts` never grows a hard dependency on D1 — it just receives a binding
 * that satisfies the tiny `D1Like` interface below.
 *
 * Like `core.ts`, this file declares its own minimal Cloudflare types so it
 * stays dependency-free (no `@cloudflare/workers-types` import needed).
 *
 * Schema lives in `migrations/0001_chatbot_sessions.sql`.
 * ==================================================================
 */

/**
 * Minimal subset of the Cloudflare D1 API we use. Declared locally so this
 * file stays dependency-free (mirrors the `KVNamespaceLike` pattern in
 * `core.ts`).
 */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
export interface D1Like {
  prepare(query: string): D1PreparedStatementLike;
}

/** Lifecycle of a conversation. Drives later escalation / handoff work. */
export type SessionStatus = 'ai_active' | 'escalated' | 'human_active' | 'closed';

/** Who authored a stored message. */
export type MessageRole = 'visitor' | 'ai' | 'human' | 'system';

/** A message row as stored in D1. */
export interface StoredMessage {
  id: number;
  session_id: string;
  role: MessageRole;
  content: string;
  model_used: string | null;
  created_at: number;
}

/** Role in the OpenRouter/OpenAI chat-completions vocabulary. */
type OpenRouterRole = 'system' | 'user' | 'assistant';

/** A message shaped for the OpenRouter `messages` array. */
export interface HistoryMessage {
  role: OpenRouterRole;
  content: string;
}

/**
 * Map a stored role to the OpenRouter vocabulary: the visitor is the `user`,
 * while the AI and any human agent both speak as the `assistant` from the
 * model's point of view. `system` passes through unchanged.
 */
function toOpenRouterRole(role: MessageRole): OpenRouterRole {
  switch (role) {
    case 'visitor':
      return 'user';
    case 'system':
      return 'system';
    default:
      return 'assistant'; // ai | human
  }
}

/**
 * Insert a fresh session (status defaults to `ai_active`) and return its id.
 * The id is a UUID generated here so the caller gets it without a round-trip.
 */
export async function createSession(db: D1Like): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (id) VALUES (?)').bind(id).run();
  return id;
}

/**
 * Append one message to a session. `modelUsed` is only meaningful for `ai`
 * rows (the OpenRouter model that produced the reply); leave it undefined
 * otherwise and it's stored as NULL.
 */
export async function appendMessage(
  db: D1Like,
  sessionId: string,
  role: MessageRole,
  content: string,
  modelUsed?: string
): Promise<number> {
  const res = await db
    .prepare('INSERT INTO messages (session_id, role, content, model_used) VALUES (?, ?, ?, ?)')
    .bind(sessionId, role, content, modelUsed ?? null)
    .run();
  return res?.meta?.last_row_id ?? 0;
}

/**
 * Fetch a session's messages oldest-first. Pass `sinceTimestamp` (unix epoch
 * seconds) to return only messages created after that point — handy for
 * polling new turns during a later human handoff.
 */
export async function getMessages(
  db: D1Like,
  sessionId: string,
  sinceTimestamp?: number
): Promise<StoredMessage[]> {
  const stmt =
    sinceTimestamp === undefined
      ? db
          .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
          .bind(sessionId)
      : db
          .prepare(
            'SELECT * FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC, id ASC'
          )
          .bind(sessionId, sinceTimestamp);

  const { results } = await stmt.all<StoredMessage>();
  return results;
}

/** Read a session's status, or `null` if the session doesn't exist. */
export async function getStatus(db: D1Like, sessionId: string): Promise<SessionStatus | null> {
  const row = await db
    .prepare('SELECT status FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ status: SessionStatus }>();
  return row?.status ?? null;
}

/** Update a session's status (e.g. escalate to a human). */
export async function setStatus(db: D1Like, sessionId: string, status: SessionStatus): Promise<void> {
  await db.prepare('UPDATE sessions SET status = ? WHERE id = ?').bind(status, sessionId).run();
}

/** Session lifecycle metadata read in a single row (status gate + timeout anchor). */
export interface SessionMeta {
  status: SessionStatus;
  escalated_at: number | null;
}

/**
 * Read a session's status + escalation timestamp in one query. Returns `null`
 * if the session doesn't exist. Used on every request that carries a sessionId
 * to decide whether to skip the AI call (session already with a human).
 */
export async function getSessionMeta(db: D1Like, sessionId: string): Promise<SessionMeta | null> {
  const row = await db
    .prepare('SELECT status, escalated_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ status: SessionStatus; escalated_at: number | null }>();
  return row ? { status: row.status, escalated_at: row.escalated_at ?? null } : null;
}

/**
 * Transition a session to `escalated` and stamp `escalated_at` (unix seconds).
 * The timestamp anchors the widget's escalation-timeout fallback server-side.
 */
export async function setEscalated(db: D1Like, sessionId: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET status = 'escalated', escalated_at = unixepoch() WHERE id = ?")
    .bind(sessionId)
    .run();
}

/** Store the visitor's contact (email/phone) captured during escalation. */
export async function setVisitorContact(db: D1Like, sessionId: string, contact: string): Promise<void> {
  await db
    .prepare('UPDATE sessions SET visitor_contact = ? WHERE id = ?')
    .bind(contact, sessionId)
    .run();
}

/**
 * The most recently escalated session still awaiting/with a human. Used to
 * route a Telegram reply that wasn't a quote-reply (so carries no session id) —
 * with a single human agent handling one visitor at a time this is almost
 * always the right target.
 */
export async function getLatestHandoffSession(db: D1Like): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT id FROM sessions WHERE status IN ('escalated','human_active') ORDER BY COALESCE(escalated_at, created_at) DESC, rowid DESC LIMIT 1"
    )
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Read the visitor's stored contact, or `null` if none captured. */
export async function getVisitorContact(db: D1Like, sessionId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT visitor_contact FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ visitor_contact: string | null }>();
  return row?.visitor_contact ?? null;
}

/**
 * Fetch a session's messages with `id` greater than `afterId`, oldest-first.
 * This is the polling cursor for the handoff loop: `messages.id` is a monotonic
 * AUTOINCREMENT key, so it never collides (unlike whole-second `created_at`) and
 * gives the widget an exact, gap-free "everything after what I've already seen".
 * Returns RAW roles (visitor/ai/human/system) — the widget needs to tell the
 * team's messages from Rebi's, so this deliberately does NOT map to OpenRouter roles.
 */
export async function getMessagesAfterId(
  db: D1Like,
  sessionId: string,
  afterId: number
): Promise<StoredMessage[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
    )
    .bind(sessionId, afterId)
    .all<StoredMessage>();
  return results;
}

/**
 * Lazily close sessions still marked `ai_active` whose last activity is older
 * than `staleSeconds`. Runs opportunistically inside a request (the Astro
 * Cloudflare adapter has no cron hook), so it must be cheap and best-effort.
 */
export async function closeStaleSessions(db: D1Like, staleSeconds: number): Promise<void> {
  await db
    .prepare(
      "UPDATE sessions SET status = 'closed' WHERE status = 'ai_active' AND created_at < unixepoch() - ?"
    )
    .bind(staleSeconds)
    .run();
}

/**
 * Return the last `maxMessages` messages of a session, oldest-first and already
 * mapped into the OpenRouter `messages` shape, ready to splice in after the
 * system prompt. Grabs the newest N in the DB, then reverses to chronological.
 */
export async function getRecentHistory(
  db: D1Like,
  sessionId: string,
  maxMessages: number
): Promise<HistoryMessage[]> {
  const { results } = await db
    .prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .bind(sessionId, maxMessages)
    .all<{ role: MessageRole; content: string }>();

  return results
    .reverse()
    .map((m) => ({ role: toOpenRouterRole(m.role), content: m.content }));
}
