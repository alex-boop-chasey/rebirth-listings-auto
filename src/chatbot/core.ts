/**
 * Rebirth Listings Auto — Chatbot Core Handler (PORTABLE)
 * ==================================================================
 * This is the framework-agnostic brain of the chatbot. It takes a standard
 * web `Request` plus an `env` object and returns a standard `Response`.
 * It has ZERO Astro/Node dependencies, so it runs unchanged on:
 *   - Astro (via src/pages/api/chat.ts — used locally & in this deployment)
 *   - A Cloudflare Pages Function (see the ready-to-paste wrapper at the bottom)
 *   - Any other Fetch-API runtime (Workers, Deno, Bun, etc.)
 *
 * To convert to a standalone Cloudflare Pages Function later, copy this whole
 * `src/chatbot/` folder into `/functions` (or import it) and use the
 * `onRequestPost` wrapper shown at the bottom of this file.
 * ==================================================================
 */

import { buildSystemPrompt } from './system-prompt';
import {
  TEMPERATURE,
  MAX_TOKENS,
  REASONING_EFFORT,
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  ESCALATION_RATE_MAX,
  SESSION_STALE_SECONDS,
  TURNSTILE_ENABLED,
} from './config';
import { generate, generateStream, type AIMessage } from '../ai';
import {
  type D1Like,
  createSession,
  appendMessage,
  getRecentHistory,
  getMessages,
  getSessionMeta,
  setEscalated,
  setVisitorContact,
  getVisitorContact,
  closeStaleSessions,
} from './state';
import { sendToTelegram, sendFollowUpToTelegram } from './telegram';

/**
 * Minimal subset of the Cloudflare KV API we use. Declared locally so `core.ts`
 * stays dependency-free (no `@cloudflare/workers-types` import needed).
 */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Environment bindings this handler needs (set in .dev.vars locally / CF dashboard in prod). */
export interface ChatEnv {
  OPENROUTER_API_KEY?: string;
  /**
   * Cloudflare KV namespace for per-IP rate limiting. Optional — if unbound
   * (e.g. local dev without KV), rate limiting is skipped and requests pass.
   */
  RATE_LIMIT_KV?: KVNamespaceLike;
  /**
   * Cloudflare D1 database for persistent conversation memory. Optional — if
   * unbound (e.g. local dev without D1), all persistence is skipped and the
   * handler behaves exactly as it did before: stateless and fail-open.
   */
  CHAT_DB?: D1Like;
  /**
   * Telegram human-handoff config. All optional and fail-open: if the bot
   * token is absent (e.g. local dev before the bot is provisioned), escalation
   * still flips the session status and the widget still shows "connecting" —
   * the Telegram notification is just logged-and-skipped. See chatbot/telegram.ts.
   */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Shared secret verified against Telegram's webhook header (telegram-webhook.ts). */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /**
   * Cloudflare Turnstile secret for server-side siteverify on the first message
   * of a session (the chatbot's own dedicated widget — distinct from the contact
   * form's key). Optional — if unbound, the Turnstile check is skipped.
   */
  CHATBOT_TURNSTILE_SECRET_KEY?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets (for a `Retry-After` header). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter backed by Cloudflare KV. Stores a small
 * `{ c: count, r: resetAtEpochSeconds }` JSON value keyed by `key` and expiring
 * with the window. Used for two independent counters: ordinary chat messages
 * (`rl:<ip>`) and escalations (`esc:<ip>`), which ring the team's phone and so are
 * capped separately and more tightly.
 *
 * Note: KV is eventually consistent and has no atomic increment, so a rapid
 * burst from one IP could let a couple of extra requests through. That's an
 * acceptable trade-off for a low-traffic marketing-site chatbot; it will never
 * over-count and block a legitimate user.
 */
async function checkLimit(kv: KVNamespaceLike, key: string, max: number): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);

  let count = 0;
  let resetAt = now + RATE_LIMIT_WINDOW_SECONDS;

  const raw = await kv.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { c: number; r: number };
      // Only carry the window forward if it hasn't expired yet.
      if (typeof parsed.r === 'number' && parsed.r > now) {
        count = parsed.c;
        resetAt = parsed.r;
      }
    } catch {
      /* corrupt value — start a fresh window */
    }
  }

  if (count >= max) {
    return { allowed: false, retryAfterSeconds: Math.max(1, resetAt - now) };
  }

  const ttl = Math.max(60, resetAt - now); // KV requires expirationTtl >= 60s
  await kv.put(key, JSON.stringify({ c: count + 1, r: resetAt }), { expirationTtl: ttl });
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Normalise a line to compare against the escalation marker. Strips brackets,
 * whitespace and trailing punctuation so free-tier models that emit "Escalate.",
 * "[[ESCALATE]]", "escalate" or "[ ESCALATE ]" are all recognised.
 */
function normaliseMarker(line: string): string {
  return line.replace(/[[\]\s.!,:;-]/g, '').toLowerCase();
}

/**
 * True when the AI signalled a handoff. The marker must be (essentially) the
 * WHOLE first line — so a normal sentence like "I'll escalate this to the team"
 * never triggers it, only a deliberate lone marker does.
 */
function isEscalation(reply: string): boolean {
  const firstLine = reply.trimStart().split('\n')[0] ?? '';
  return normaliseMarker(firstLine) === 'escalate';
}

/**
 * True when Rebi signalled the enquiry looks resolved (emits `[[RESOLVED]]` as
 * the first line, followed by its normal closing message). Unlike escalation
 * this doesn't suppress the reply — it just lets the widget offer a transcript.
 */
function isResolved(reply: string): boolean {
  const firstLine = reply.trimStart().split('\n')[0] ?? '';
  return normaliseMarker(firstLine) === 'resolved';
}

/** Remove leading/inline `[[ESCALATE]]` and `[[RESOLVED]]` markers from a reply. */
function stripMarkers(text: string): string {
  const lines = text.split('\n');
  while (lines.length && (normaliseMarker(lines[0]) === 'escalate' || normaliseMarker(lines[0]) === 'resolved')) {
    lines.shift();
  }
  return lines.join('\n').replace(/\[\[\s*(?:ESCALATE|RESOLVED)\s*\]\]/gi, '').trim();
}

/** Static, honest message shown when both models fail — includes a real contact. */
const BOTH_FAILED_REPLY =
  "Sorry, Rebi's having a bit of trouble responding right now. You can reach one of our team members directly on [DEALER_PHONE] or through the contact page at /contact and we'll get back to you.";

interface ModelResult {
  ok: boolean;
  reply?: string;
  /** The model id that actually produced the reply (for the model_used column). */
  model?: string;
}

/**
 * Generate a reply via the AI provider layer. `chat-cheap` maps to the same two
 * free models in the same order (gpt-oss-20b → hermes-3); the layer owns the
 * fallback, timeout, and OpenRouter wire details. `reasoning` is passed through
 * `providerOptions` (whitelisted by the adapter). Returns the same `ModelResult`
 * shape the old code did, so `handleChatRequest` is unchanged.
 */
async function generateReply(messages: AIMessage[]): Promise<ModelResult> {
  try {
    const res = await generate({
      capability: 'chat-cheap',
      messages,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      providerOptions: { reasoning: { effort: REASONING_EFFORT } },
    });
    return { ok: true, reply: res.content, model: res.modelUsed };
  } catch (err) {
    // Any failure — including AllModelsExhaustedError when both models fail —
    // collapses to { ok: false }, and the caller renders BOTH_FAILED_REPLY,
    // exactly as the old callModel/generateReply contract did.
    console.error('[chatbot] AI generate failed', err);
    return { ok: false };
  }
}

/**
 * Cloudflare Turnstile server-side verification. Only called on a session's
 * first message when CHATBOT_TURNSTILE_SECRET_KEY is configured. Fails closed (returns
 * false) on any error, since the whole point is to gate abuse.
 */
async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch (err) {
    console.error('[chatbot] Turnstile verification failed', err);
    return false;
  }
}

/** The system message shown to the visitor the moment a handoff starts. */
const CONNECTING_MESSAGE =
  "Connecting you with our team — someone will be with you shortly. Feel free to leave your question here, and a phone or email if you'd like us to follow up.";

/** Whether an escalation is allowed for this IP (separate, tighter KV counter). */
async function escalationAllowed(env: ChatEnv, ip: string): Promise<boolean> {
  if (!env.RATE_LIMIT_KV) return true;
  try {
    return (await checkLimit(env.RATE_LIMIT_KV, `esc:${ip}`, ESCALATION_RATE_MAX)).allowed;
  } catch (err) {
    console.error('[chatbot] Escalation limit check failed (allowing)', err);
    return true;
  }
}

/**
 * Persist the visitor turn, flip the session to escalated, store the connecting
 * system message, and notify the team. Returns the system message's id (poll cursor).
 * Shared by the JSON and streaming code paths.
 */
async function performEscalation(
  env: ChatEnv,
  db: D1Like,
  sessionId: string,
  visitorText: string
): Promise<number> {
  await appendMessage(db, sessionId, 'visitor', visitorText);
  await setEscalated(db, sessionId);
  const sysId = await appendMessage(db, sessionId, 'system', CONNECTING_MESSAGE);
  await sendToTelegram(env, sessionId, await getVisitorContact(db, sessionId), await getMessages(db, sessionId));
  return sysId;
}

/** Persist a normal exchange (visitor turn + AI reply); returns the reply's id. */
async function persistExchange(
  db: D1Like,
  sessionId: string,
  visitorText: string,
  reply: string,
  model: string | undefined
): Promise<number | undefined> {
  try {
    await appendMessage(db, sessionId, 'visitor', visitorText);
    return await appendMessage(db, sessionId, 'ai', reply, model);
  } catch (err) {
    console.error('[chatbot] Persisting messages failed (reply still returned)', err);
    return undefined;
  }
}

/** Server-Sent-Events line for one JSON event. */
function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

interface StreamOpts {
  messages: AIMessage[];
  env: ChatEnv;
  db?: D1Like;
  sessionId?: string;
  ip: string;
  visitorText: string;
}

/**
 * Streaming (SSE) path. Streams the reply token-by-token via the AI layer's
 * `generateStream` (chat-cheap tier, with pre-first-token fallback across the two
 * models), holding back a lead window so it can detect a leading [[ESCALATE]]
 * marker BEFORE any text reaches the visitor — escalation must never flash
 * suppressed text. Any streaming failure emits `{type:'error'}`; the widget then
 * retries with `stream:false`, which runs the non-streaming failsafe over JSON.
 * Events: `delta` | `done` | `escalate` | `error`.
 */
function streamChatResponse(opts: StreamOpts): Response {
  const { messages, env, db, sessionId, ip, visitorText } = opts;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(sseEvent(o)));

      let resolved = false; // did Rebi signal the enquiry looks resolved?
      // The model that actually served this stream (primary or fallback),
      // captured from the terminal chunk for the model_used column.
      let modelUsed: string | undefined;

      // Finish the normal (non-escalation) way: persist + emit `done`.
      const finishNormal = async (text: string, alreadyStreamed: boolean) => {
        if (isResolved(text)) resolved = true;
        const clean = stripMarkers(text);
        if (!clean) {
          send({ type: 'error' });
          return;
        }
        if (!alreadyStreamed) send({ type: 'delta', text: clean });
        const lastId = db && sessionId ? await persistExchange(db, sessionId, visitorText, clean, modelUsed) : undefined;
        send({ type: 'done', sessionId, status: 'ai_active', lastId, resolved });
      };

      try {
        let content = '';
        let decided = false; // have we ruled the marker in/out?
        let streaming = false; // are we forwarding deltas live?
        let escalating = false;

        // Decide escalation vs normal once we have a full first line (or the
        // stream ended). Until then, buffer silently.
        const decide = (isFinal: boolean) => {
          if (decided) return;
          const hasNewline = content.includes('\n');
          if (!isFinal && !hasNewline && content.length < 24) return;
          decided = true;
          if (isEscalation(content)) {
            escalating = true;
          } else {
            streaming = true;
            if (isResolved(content)) resolved = true;
            const clean = stripMarkers(content);
            if (clean) send({ type: 'delta', text: clean });
          }
        };

        // Stream via the AI layer. It owns the OpenRouter wire format, the
        // per-attempt timeout, and pre-first-token fallback across chat-cheap's
        // two models. The [[ESCALATE]] marker suppression + buffering stay HERE
        // in the chatbot — the layer just yields `{ delta }` chunks. The terminal
        // chunk carries the authoritative model that served (may be the fallback).
        for await (const chunk of generateStream({
          capability: 'chat-cheap',
          messages,
          temperature: TEMPERATURE,
          maxTokens: MAX_TOKENS,
          providerOptions: { reasoning: { effort: REASONING_EFFORT } },
        })) {
          if (chunk.done) {
            modelUsed = chunk.modelUsed;
            continue;
          }
          const piece = chunk.delta;
          if (piece) {
            content += piece;
            if (!decided) decide(false);
            else if (streaming) send({ type: 'delta', text: piece });
            // decided && escalating → keep buffering silently
          }
        }
        if (!decided) decide(true);

        if (escalating && db && sessionId && (await escalationAllowed(env, ip))) {
          try {
            const sysId = await performEscalation(env, db, sessionId, visitorText);
            send({ type: 'escalate', sessionId, status: 'escalated', lastId: sysId });
          } catch (err) {
            console.error('[chatbot] Streaming escalation failed — normal reply', err);
            await finishNormal(content || BOTH_FAILED_REPLY, false);
          }
        } else if (escalating) {
          // No D1, or escalation rate-limited: answer with the marker stripped.
          await finishNormal(content || 'Let me get our team to help — reach us on [DEALER_PHONE] or via /contact.', false);
        } else {
          await finishNormal(content, streaming);
        }
      } catch (err) {
        // Any failure from the AI layer (AllModelsExhaustedError, or a
        // StreamInterruptedError once tokens were already sent) surfaces the same
        // way the old path did — an `error` event — so the widget retries with
        // stream:false and runs the non-streaming failsafe.
        console.error('[chatbot] Streaming error', (err as Error)?.name === 'AbortError' ? 'aborted' : err);
        try {
          send({ type: 'error' });
        } catch {
          /* controller already closed */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Validate + normalise the incoming conversation history from the client.
 * Returns a trimmed, sanitised array or throws a user-facing error message.
 */
function parseHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error('`messages` must be an array.');

  const cleaned: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as ChatMessage).role;
    const content = (m as ChatMessage).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    cleaned.push({ role, content: trimmed.slice(0, MAX_MESSAGE_CHARS) });
  }

  if (cleaned.length === 0) throw new Error('No valid messages provided.');
  if (cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('The last message must come from the user.');
  }

  // Keep only the most recent turns to control token cost.
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * The main entry point. Framework-agnostic: give it a Request + env,
 * get a Response back.
 */
export async function handleChatRequest(request: Request, env: ChatEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[chatbot] Missing OPENROUTER_API_KEY');
    return json({ error: 'The chat assistant is not configured right now.' }, 500);
  }

  // Parse request body. Besides `messages` + `sessionId`, the widget may send
  // `turnstileToken` (first message) and `contact` (email/phone shared during
  // an escalation).
  let body: {
    messages?: unknown;
    sessionId?: unknown;
    turnstileToken?: unknown;
    contact?: unknown;
    stream?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const db = env.CHAT_DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  let sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 200) : '';
  const hasMessages = Array.isArray(body.messages) && (body.messages as unknown[]).length > 0;

  // --- Contact-only submission (visitor shared a phone/email during handoff) ---
  if (contact && !hasMessages) {
    let status: string = 'ai_active';
    if (db && sessionId) {
      try {
        await setVisitorContact(db, sessionId, contact);
        await sendFollowUpToTelegram(env, sessionId, `(shared contact: ${contact})`);
        status = (await getSessionMeta(db, sessionId))?.status ?? 'ai_active';
      } catch (err) {
        console.error('[chatbot] Storing contact failed', err);
      }
    }
    return json({ sessionId, status });
  }

  // --- Normal message submission ---
  let history: ChatMessage[];
  try {
    history = parseHistory(body.messages);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  // Per-IP message rate limiting (before any upstream call). Skipped if KV unbound.
  if (env.RATE_LIMIT_KV) {
    try {
      const rl = await checkLimit(env.RATE_LIMIT_KV, `rl:${ip}`, RATE_LIMIT_MAX);
      if (!rl.allowed) {
        console.log(`[chatbot] Rate limit exceeded for ${ip} (retry in ${rl.retryAfterSeconds}s)`);
        return json(
          { error: "You've reached the chat limit — try again later or get in touch via [DEALER_URL]/contact." },
          429,
          { 'Retry-After': String(rl.retryAfterSeconds) }
        );
      }
    } catch (err) {
      // Fail open: a rate-limit store hiccup must never block a real visitor.
      console.error('[chatbot] Rate limit check failed (allowing request)', err);
    }
  }

  const systemMessage = { role: 'system' as const, content: buildSystemPrompt() };
  const latestUserMessage = history[history.length - 1]; // parseHistory guarantees this is the user's turn

  // Look up the session's status WITHOUT minting yet, so the Turnstile gate can
  // decide "new visitor" server-side (a bot can't skip it by inventing an id)
  // and a failed challenge doesn't leave an orphan session.
  let meta: Awaited<ReturnType<typeof getSessionMeta>> = null;
  if (db && sessionId) {
    try {
      meta = await getSessionMeta(db, sessionId);
    } catch (err) {
      console.error('[chatbot] Session lookup failed (continuing stateless)', err);
      meta = null;
    }
  }
  // New visitor = no known session. Without D1 we can't tell server-side, so
  // fall back to "client sent no id".
  const isNewVisitor = db ? meta === null : !sessionId;

  // Turnstile gate for a new visitor's first message. Skipped when disabled, the
  // secret isn't configured, or on localhost (the Turnstile widget's allowed
  // hostnames only cover the live domain, so the challenge can't issue a token
  // in local dev — gating there would block every first message).
  const host = request.headers.get('host') || '';
  const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  if (TURNSTILE_ENABLED && !isLocalhost && env.CHATBOT_TURNSTILE_SECRET_KEY && isNewVisitor) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!token || !(await verifyTurnstile(env.CHATBOT_TURNSTILE_SECRET_KEY, token, ip))) {
      return json({ error: 'Please complete the verification and try again.' }, 403);
    }
  }

  // Now mint the session if needed (verified past Turnstile).
  if (db) {
    try {
      if (isNewVisitor) {
        sessionId = await createSession(db);
        meta = null;
        // Opportunistic, best-effort GC — the Astro adapter has no cron hook.
        closeStaleSessions(db, SESSION_STALE_SECONDS).catch(() => {});
      }
      if (sessionId && contact) await setVisitorContact(db, sessionId, contact);
    } catch (err) {
      console.error('[chatbot] Session setup failed (continuing stateless)', err);
      sessionId = undefined;
      meta = null;
    }
  }

  // --- Session already with a human: skip the AI, store + forward the message ---
  if (db && sessionId && meta && (meta.status === 'escalated' || meta.status === 'human_active')) {
    try {
      const vid = await appendMessage(db, sessionId, 'visitor', latestUserMessage.content);
      await sendFollowUpToTelegram(env, sessionId, latestUserMessage.content);
      return json({ sessionId, status: meta.status, lastId: vid });
    } catch (err) {
      console.error('[chatbot] Forwarding to human failed', err);
      return json({ sessionId, status: meta.status });
    }
  }

  // Build the conversation for the model. With D1 bound, memory is server-side
  // (system prompt + recent history + the new user turn); otherwise fall back to
  // the client-supplied history — today's stateless behaviour.
  let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  if (db && sessionId) {
    try {
      const priorHistory = await getRecentHistory(db, sessionId, MAX_HISTORY_MESSAGES);
      messages = [systemMessage, ...priorHistory, latestUserMessage];
    } catch (err) {
      console.error('[chatbot] Loading session history failed (continuing stateless)', err);
      messages = [systemMessage, ...history];
    }
  } else {
    messages = [systemMessage, ...history];
  }

  // --- Streaming path (SSE) ---
  // When the client opts into streaming, hand off to the SSE responder. It
  // streams the primary model token-by-token with leading-marker suppression,
  // and on a primary failure emits `{type:'error'}` so the widget retries with
  // stream:false (this JSON path below, which runs the full failsafe).
  if (body.stream === true) {
    return streamChatResponse({
      messages,
      env,
      db,
      sessionId,
      ip,
      visitorText: latestUserMessage.content,
    });
  }

  // chat-cheap tier: primary → fallback, via the AI layer (see generateReply).
  const result = await generateReply(messages);

  // Both models failed: return an honest, contactful message as a normal reply
  // (HTTP 200) so it renders as a Rebi bubble rather than an error toast.
  if (!result.ok || !result.reply) {
    console.error('[chatbot] Both models failed');
    if (db && sessionId) {
      try {
        await appendMessage(db, sessionId, 'visitor', latestUserMessage.content);
        await appendMessage(db, sessionId, 'system', BOTH_FAILED_REPLY);
      } catch (err) {
        console.error('[chatbot] Persist on both-failed failed', err);
      }
    }
    return json({ reply: BOTH_FAILED_REPLY, sessionId, status: 'ai_active' });
  }

  const rawReply = result.reply;

  // --- AI-triggered escalation: the reply is the lone [[ESCALATE]] marker ---
  if (db && sessionId && isEscalation(rawReply)) {
    if (await escalationAllowed(env, ip)) {
      try {
        const sysId = await performEscalation(env, db, sessionId, latestUserMessage.content);
        return json({ sessionId, status: 'escalated', lastId: sysId });
      } catch (err) {
        console.error('[chatbot] Escalation failed — falling back to a normal reply', err);
        return json({ reply: stripMarkers(rawReply) || BOTH_FAILED_REPLY, sessionId, status: 'ai_active' });
      }
    }
    console.log('[chatbot] Escalation rate-limited for', ip);
    // Rate-limited: fall through and answer with the marker stripped.
  }

  // --- Normal reply (may carry a [[RESOLVED]] hint) ---
  const resolved = isResolved(rawReply);
  let reply = stripMarkers(rawReply);
  if (!reply) reply = 'Let me get our team to help with that — you can reach us on [DEALER_PHONE] or via /contact.';

  const lastId = db && sessionId ? await persistExchange(db, sessionId, latestUserMessage.content, reply, result.model) : undefined;
  return json({ reply, sessionId, status: 'ai_active', lastId, resolved });
}

/* ==================================================================
 * CLOUDFLARE PAGES FUNCTION WRAPPER (ready to use later)
 * ------------------------------------------------------------------
 * When you move off the Astro API route to a standalone Pages Function,
 * create `functions/api/chat.ts` with:
 *
 *   import { handleChatRequest } from '../../src/chatbot/core';
 *   type Env = {
 *     OPENROUTER_API_KEY: string;
 *     RATE_LIMIT_KV?: KVNamespace;
 *     CHAT_DB?: D1Database;
 *   };
 *   export const onRequestPost: PagesFunction<Env> =
 *     (context) => handleChatRequest(context.request, context.env);
 *
 * `context.env` on Cloudflare already contains OPENROUTER_API_KEY (set it as a
 * Pages environment variable / secret) and, if configured, the RATE_LIMIT_KV
 * and CHAT_DB bindings. No other changes required.
 * ================================================================== */
