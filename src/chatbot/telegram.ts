/**
 * Astro Motors — Telegram human-handoff bridge
 * ==================================================================
 * Sends escalation notifications to the team and parses their replies back out
 * of Telegram webhook payloads. Dependency-free and FAIL-OPEN: if the bot token
 * / chat id aren't configured (e.g. local dev before the bot exists), sends are
 * logged-and-skipped so the rest of the handoff flow still works end to end.
 *
 * Routing model: there is exactly ONE recipient (the team's chat). To know which
 * visitor session a reply belongs to, every notification embeds a delimited
 * `#sess:<uuid>` token. Telegram preserves `reply_to_message.text`, so when a
 * team member quote-replies we recover the session id from the quoted notification.
 * ==================================================================
 */

import type { StoredMessage } from './state';

const TG_API = 'https://api.telegram.org';

/** Minimal env this module needs — structurally satisfied by core.ts's ChatEnv. */
export interface TelegramConfig {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const SESS_PREFIX = '#sess:';

/** The machine-parseable token embedded in every notification. */
export function sessionTag(sessionId: string): string {
  return `${SESS_PREFIX}${sessionId}`;
}

/** Pull a `#sess:<uuid>` token back out of a (quoted) message's text. */
export function extractSessionId(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(/#sess:([0-9a-fA-F-]{36})/);
  return m ? m[1].toLowerCase() : null;
}

function label(role: StoredMessage['role']): string {
  switch (role) {
    case 'visitor':
      return 'Visitor';
    case 'human':
      return 'Team';
    case 'ai':
      return 'Rebi';
    default:
      return 'System';
  }
}

async function tgSend(token: string, chatId: string, text: string): Promise<void> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error('[chatbot] Telegram sendMessage failed', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[chatbot] Telegram send error', err);
  }
}

/**
 * Notify the team that a visitor needs a human. Includes the recent transcript,
 * any captured contact, and the session token for reply-routing. No-op (logged)
 * when the bot isn't configured.
 */
export async function sendToTelegram(
  env: TelegramConfig,
  sessionId: string,
  contact: string | null,
  lastMessages: StoredMessage[]
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[chatbot] Telegram not configured — escalation notification skipped', sessionTag(sessionId));
    return;
  }

  const transcript = lastMessages
    .slice(-6)
    .map((m) => `${label(m.role)}: ${m.content}`)
    .join('\n');

  // TODO: swap [DEALER_URL] for the demo's real domain when it's live.
  const text =
    `🔔 A visitor on [DEALER_URL] needs a human.\n\n` +
    `Contact: ${contact || '(not provided yet)'}\n\n` +
    `Recent conversation:\n${transcript || '(no messages)'}\n\n` +
    `↩️ Reply to THIS message to answer the visitor. Reply "/bot" to hand the chat back to Rebi.\n` +
    sessionTag(sessionId);

  await tgSend(token, chatId, text);
}

/**
 * Forward a follow-up visitor message that arrived while the session is already
 * escalated / with a human. Carries the session token so the team can quote-reply.
 */
export async function sendFollowUpToTelegram(
  env: TelegramConfig,
  sessionId: string,
  text: string
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[chatbot] Telegram not configured — follow-up skipped', sessionTag(sessionId));
    return;
  }
  await tgSend(token, chatId, `💬 Visitor: ${text}\n\n↩️ Reply to route your answer.\n${sessionTag(sessionId)}`);
}

/** A parsed inbound reply from the team. */
export interface ParsedReply {
  /**
   * Session id recovered from a quote-reply's `#sess:` token, or null when a team
   * member just typed a normal message (not a quote-reply). The webhook falls back
   * to the most-recently-escalated session in that case.
   */
  sessionId: string | null;
  text: string;
  /** True when a team member sent "/bot" to hand the session back to the AI. */
  isHandback: boolean;
  chatId: number | string | undefined;
  updateId: number | undefined;
}

/**
 * Extract the team's reply text + (if they quote-replied) the target session
 * from a Telegram webhook update. Returns null only when there's no usable text
 * message at all. Pure function — unit-testable with a fixture payload.
 */
export function parseTelegramReply(update: unknown): ParsedReply | null {
  const u = update as {
    update_id?: number;
    message?: {
      text?: string;
      chat?: { id?: number | string };
      reply_to_message?: { text?: string };
    };
  };
  const msg = u?.message;
  if (!msg) return null;

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!text) return null;

  return {
    sessionId: extractSessionId(msg.reply_to_message?.text),
    text,
    isHandback: text.toLowerCase() === '/bot',
    chatId: msg.chat?.id,
    updateId: u.update_id,
  };
}
