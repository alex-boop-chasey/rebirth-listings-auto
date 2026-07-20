/**
 * Rebirth Listings Auto — Chat poll endpoint (handoff live updates)
 * ------------------------------------------------------------------
 * The widget polls this while a session is `escalated` / `human_active` so the
 * team's Telegram replies appear in the thread without a reload. It returns the
 * session status plus any messages newer than the client's cursor.
 *
 * Cursor is the monotonic `messages.id` (NOT `created_at`, which is only
 * whole-second resolution and would drop same-second messages). Pass
 * `afterId=0` for a full hydrate.
 *
 * Roles are returned RAW (visitor/ai/human/system) so the widget can render
 * the team's messages distinctly from Rebi's — deliberately not mapped to
 * OpenRouter roles the way getRecentHistory does.
 *
 * Env is read via get-env.ts (cloudflare:workers), not `locals.runtime.env`.
 */

import type { APIRoute } from 'astro';
import type { D1Like } from '~/chatbot/state';
import { getMessagesAfterId, getStatus } from '~/chatbot/state';
import { getChatEnv } from '~/chatbot/get-env';

export const prerender = false; // CRITICAL: dynamic route, not pre-rendered

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const afterId = Number.parseInt(url.searchParams.get('afterId') ?? '0', 10) || 0;

  if (!sessionId) return json({ error: 'Missing sessionId.' }, 400);

  const db = getChatEnv().CHAT_DB as D1Like | undefined;

  // No D1 (e.g. local dev without the binding): nothing to poll — say so calmly.
  if (!db) return json({ status: null, messages: [], lastId: afterId });

  try {
    const status = await getStatus(db, sessionId);
    if (status === null) return json({ status: null, messages: [], lastId: afterId });

    const rows = await getMessagesAfterId(db, sessionId, afterId);
    const messages = rows.map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at }));
    const lastId = rows.length ? rows[rows.length - 1].id : afterId;
    return json({ status, messages, lastId });
  } catch (err) {
    console.error('[chatbot] chat-poll failed', err);
    // Fail soft — the widget keeps its current view and retries next tick.
    return json({ status: null, messages: [], lastId: afterId });
  }
};
