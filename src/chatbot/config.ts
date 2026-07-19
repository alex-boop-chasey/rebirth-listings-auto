/**
 * Astro Motors — Chatbot Config
 * ------------------------------------------------------------------
 * Central knobs for the chatbot. Change the model, generation params, or
 * limits here. No dependencies — portable to a Cloudflare Worker/Pages Function.
 */

// OpenRouter is OpenAI-compatible. See https://openrouter.ai/docs/quickstart
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free model requested for this project.
// https://openrouter.ai/openai/gpt-oss-20b:free
export const MODEL = 'openai/gpt-oss-20b:free';

// Failsafe: if the primary model errors, times out, or returns an empty
// completion, we retry ONCE against this model before giving up. Kept on the
// free tier per project preference — a different provider from the primary so
// a single provider's outage doesn't take both down. It's a one-line swap to a
// cheap paid model (e.g. 'openai/gpt-4o-mini') if free-tier reliability isn't
// enough. NOTE: this is not a reasoning model, so the `reasoning` param is only
// sent for the primary (see core.ts callModel).
export const FALLBACK_MODEL = 'nousresearch/hermes-3-llama-3.1-405b:free';

// Sent to OpenRouter for ranking/analytics (optional but recommended).
export const APP_URL = 'https://astro-listings-demo.example.com';
export const APP_TITLE = 'Astro Motors';

// Generation parameters.
export const TEMPERATURE = 0.5;
export const MAX_TOKENS = 700;

// IMPORTANT: gpt-oss-20b is a *reasoning* model — by default it spends tokens
// (and time) "thinking" before it writes an answer, which is slow on the free
// tier and can leave `message.content` empty if the token budget runs out.
// Keeping reasoning effort low makes replies fast (~4-6s) and reliable.
// https://openrouter.ai/docs/use-cases/reasoning-tokens
export const REASONING_EFFORT = 'low'; // 'low' | 'medium' | 'high'

// Abuse / cost guards.
export const MAX_MESSAGE_CHARS = 2000; // per user message
export const MAX_HISTORY_MESSAGES = 12; // most recent turns kept (excl. system)
// Per-ATTEMPT timeout (not total). With the failsafe we may make two attempts
// (primary then fallback), each getting its own AbortController + this budget,
// so the worst case stays comfortably under a minute rather than 2×45s.
export const REQUEST_TIMEOUT_MS = 22000;

// --- Human handoff (Telegram) ---
// How long the widget waits for the team's first Telegram reply after an
// escalation before showing the "they'll follow up by [contact]" fallback.
// Applies only to the escalated → first-human-reply gap, never during an active
// human chat.
export const ESCALATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Max AI-triggered escalations per IP per rate-limit window. Escalations ping
// the team's phone, so they're capped independently of ordinary chat messages to
// stop a visitor coaxing the model into spamming them.
export const ESCALATION_RATE_MAX = 3;
// How often the widget polls chat-poll for new human/AI messages during a
// handoff. Human replies arrive at human speed, so a few seconds is plenty.
export const POLL_INTERVAL_MS = 3000;
// Sessions with no activity for this long can be lazily closed (see core.ts).
export const SESSION_STALE_SECONDS = 24 * 60 * 60; // 24 hours

// Cloudflare Turnstile — DEDICATED widget for the chatbot (separate from the
// contact form's). The site key is public (rendered client-side in the widget);
// the matching secret is the CHATBOT_TURNSTILE_SECRET_KEY env var / Cloudflare secret,
// validated server-side in core.ts.
//
// MASTER SWITCH: gates BOTH the widget challenge and the server-side check.
// Turnstile is automatically bypassed on localhost/127.0.0.1 (see core.ts +
// ChatWidget) because the widget's allowed hostnames only list the live domain
// — so local dev isn't blocked while production stays protected. Flip this to
// `false` if you ever need to kill the gate entirely.
export const TURNSTILE_ENABLED = true;
// TODO: provision a NEW Cloudflare Turnstile widget for the demo domain and paste
// its public site key here (the old Rebirth key only allows the live rebirth
// hostname, so it will not render on this demo). Turnstile is auto-bypassed on
// localhost, so local dev works with this placeholder.
export const TURNSTILE_SITE_KEY = 'REPLACE_ME';

// Per-IP rate limiting. Requires a Cloudflare KV namespace bound as RATE_LIMIT_KV
// (see chatbot/README.md). If the binding is absent (e.g. local dev without KV),
// rate limiting is skipped and all requests are allowed.
export const RATE_LIMIT_MAX = 10; // max messages per IP per window
export const RATE_LIMIT_WINDOW_SECONDS = 3600; // window length (1 hour)
