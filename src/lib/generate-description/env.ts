/**
 * Env reader for the description-generator endpoint.
 *
 * Reads the raw Worker env from `cloudflare:workers` (the same mechanism as the
 * chatbot's get-env.ts), but is self-contained: it does NOT import the chatbot
 * module (off-limits) and pulls only what this feature needs — including the
 * Sanity read token, which the chatbot's `ChatEnv` does not carry. String
 * secrets keep an `import.meta.env` fallback for non-Cloudflare local runs, as
 * get-env.ts does.
 */
import { env as cfEnv } from 'cloudflare:workers';
import type { KVNamespaceLike } from '../../chatbot/core';

export interface DescriptionEnv {
  /** OpenRouter key for the AI layer (same var the chatbot/search use). */
  OPENROUTER_API_KEY?: string;
  /** Sanity token with read access to drafts — Worker runtime (.dev.vars / secret). */
  SANITY_TOKEN?: string;
  /** KV binding for per-IP rate limiting; absent in local dev without KV. */
  RATE_LIMIT_KV?: KVNamespaceLike;
}

export function getDescriptionEnv(): DescriptionEnv {
  const e = cfEnv as unknown as Record<string, unknown>;
  return {
    OPENROUTER_API_KEY:
      (e.OPENROUTER_API_KEY as string | undefined) ?? import.meta.env.OPENROUTER_API_KEY,
    SANITY_TOKEN: (e.SANITY_TOKEN as string | undefined) ?? import.meta.env.SANITY_TOKEN,
    RATE_LIMIT_KV: e.RATE_LIMIT_KV as KVNamespaceLike | undefined,
  };
}
