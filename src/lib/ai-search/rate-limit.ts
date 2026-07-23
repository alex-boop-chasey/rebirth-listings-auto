/**
 * Per-IP fixed-window rate limiter for the AI-search endpoint.
 *
 * This deliberately mirrors the chatbot's KV limiter (`checkLimit` in
 * src/chatbot/core.ts): the SAME fixed-window scheme, the SAME `{ c, r }` JSON
 * storage shape, the SAME fail-open contract, and a 429 + Retry-After on block.
 *
 * Why a small replica instead of importing that helper:
 *   1. It lives in src/chatbot/, which this ticket must leave alone, and it is
 *      module-private (not exported).
 *   2. Its window is hardcoded to the chatbot's global constant, but this
 *      feature's window is dealer-tunable (dealerConfig.ai.search.rateLimit).
 * So the algorithm is reused; only the window is parameterized. A distinct key
 * prefix (default `ais:`) keeps counters from colliding — callers on other
 * endpoints pass their own prefix (e.g. the description generator uses `desc:`).
 *
 * The KV type is imported (not redefined) from the chatbot module.
 */
import type { KVNamespaceLike } from '../../chatbot/core';

export interface RateLimitSettings {
  windowSeconds: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for a Retry-After header). 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Check (and, when allowed, increment) the caller's counter. Fixed-window: stores
 * `{ c: count, r: resetAtEpochSeconds }`. KV is eventually consistent with no
 * atomic increment, so a burst can leak a couple of extra requests — acceptable,
 * same as the chatbot.
 */
export async function checkSearchRateLimit(
  kv: KVNamespaceLike,
  ip: string,
  settings: RateLimitSettings,
  keyPrefix = 'ais:',
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const key = `${keyPrefix}${ip}`;

  let count = 0;
  let resetAt = now + settings.windowSeconds;

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

  if (count >= settings.maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, resetAt - now) };
  }

  const ttl = Math.max(60, resetAt - now); // KV requires expirationTtl >= 60s
  await kv.put(key, JSON.stringify({ c: count + 1, r: resetAt }), { expirationTtl: ttl });
  return { allowed: true, retryAfterSeconds: 0 };
}
