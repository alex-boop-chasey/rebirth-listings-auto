/**
 * Rebirth Auto — Telegram webhook (the team's replies → the visitor's chat)
 * ------------------------------------------------------------------
 * Telegram POSTs here whenever a team member sends a message to the bot. A
 * verified quote-reply to an escalation notification is written into the
 * matching session as a `human` message and flips the session to `human_active`;
 * the visitor's widget is polling chat-poll and picks it up within a few seconds.
 *
 * Security: the request is authenticated by the `secret_token` we set on
 * `setWebhook`, which Telegram echoes back in the
 * `X-Telegram-Bot-Api-Secret-Token` header. We verify it BEFORE reading the
 * body — an unverified webhook would let anyone inject fake "human" replies.
 *
 * Env is read via get-env.ts (cloudflare:workers), not `locals.runtime.env`.
 */

import type { APIRoute } from 'astro';
import type { D1Like } from '~/chatbot/state';
import { appendMessage, setStatus, getStatus, getLatestHandoffSession } from '~/chatbot/state';
import { parseTelegramReply } from '~/chatbot/telegram';
import { getChatEnv } from '~/chatbot/get-env';

export const prerender = false; // CRITICAL: dynamic route, not pre-rendered

// Best-effort in-memory dedupe of Telegram's at-least-once delivery. Telegram
// retries on a non-200 or a slow response; ignoring a repeated update_id stops a
// duplicate "human" message. Resets on cold start — acceptable at this scale.
const seenUpdates = new Set<number>();

export const POST: APIRoute = async ({ request }) => {
  const env = getChatEnv();
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  const chatId = env.TELEGRAM_CHAT_ID;
  const db = env.CHAT_DB as D1Like | undefined;

  // 1) Verify the shared secret BEFORE touching the body.
  if (!secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Telegram only cares that we return 200 quickly; it ignores the body.
  const ok = () => new Response('ok', { status: 200 });

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return ok(); // malformed — nothing to do, but don't make Telegram retry
  }

  const reply = parseTelegramReply(update);
  if (!reply) return ok(); // no usable text message

  // 2) Defense in depth: only accept replies from the team's own chat.
  if (chatId && reply.chatId !== undefined && String(reply.chatId) !== String(chatId)) {
    console.warn('[chatbot] Telegram reply from unexpected chat', reply.chatId);
    return ok();
  }

  // 3) Dedupe retried deliveries.
  if (reply.updateId !== undefined) {
    if (seenUpdates.has(reply.updateId)) return ok();
    seenUpdates.add(reply.updateId);
  }

  if (!db) {
    console.log('[chatbot] Telegram webhook received but D1 unbound — dropping');
    return ok();
  }

  try {
    // Prefer the session from a quote-reply; otherwise route to the most
    // recently escalated session (single-agent handoff — usually the only one).
    const sessionId = reply.sessionId ?? (await getLatestHandoffSession(db));
    if (!sessionId) {
      console.log('[chatbot] Telegram reply with no target session (none active)');
      return ok();
    }

    if (reply.isHandback) {
      await setStatus(db, sessionId, 'ai_active'); // "/bot" → back to the AI
    } else if ((await getStatus(db, sessionId)) !== null) {
      await appendMessage(db, sessionId, 'human', reply.text);
      await setStatus(db, sessionId, 'human_active');
    }
  } catch (err) {
    console.error('[chatbot] Telegram webhook DB write failed', err);
  }

  return ok();
};
