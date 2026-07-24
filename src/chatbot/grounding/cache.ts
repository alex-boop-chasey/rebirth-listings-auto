/**
 * Optional KV TTL cache for grounding blocks.
 * ------------------------------------------------------------------
 * All grounding output is plain text, so the cache stores/returns strings.
 * The cache is entirely OPTIONAL and fail-open: if no `GROUNDING_KV` namespace
 * is bound (the common case today — the owner adds the binding later, see
 * get-env.ts), or if any KV op throws, we transparently fall through to the
 * live `producer()`. A cache hiccup must never break a chat turn.
 */
import type { KVNamespaceLike } from '../core';

/**
 * Return `key` from KV if present, else run `producer()`, cache its result for
 * `ttlSeconds`, and return it. Any KV error is swallowed and the live value is
 * returned. `producer` errors propagate (the caller decides how to degrade).
 */
export async function cachedText(
  kv: KVNamespaceLike | undefined,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<string>,
): Promise<string> {
  if (kv) {
    try {
      const hit = await kv.get(key);
      if (hit !== null) return hit;
    } catch (err) {
      console.error('[grounding] KV read failed (reading live)', err);
    }
  }

  const value = await producer();

  if (kv) {
    try {
      // KV requires expirationTtl >= 60s; clamp up so short TTLs still write.
      await kv.put(key, value, { expirationTtl: Math.max(60, ttlSeconds) });
    } catch (err) {
      console.error('[grounding] KV write failed (value still returned)', err);
    }
  }

  return value;
}
