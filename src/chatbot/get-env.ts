/**
 * Chatbot env loader (Cloudflare Worker / Astro 7 + @astrojs/cloudflare v14)
 * ------------------------------------------------------------------
 * v14 removed `Astro.locals.runtime.env` (it now throws). Bindings and secrets
 * are read from the `cloudflare:workers` virtual module instead — populated in
 * production by the Worker runtime, and in `astro dev` by the adapter's bundled
 * @cloudflare/vite-plugin (reads wrangler.jsonc bindings + .dev.vars secrets).
 *
 * This is the ONE place the raw env is touched, so the three API routes stay
 * thin wrappers. `cfEnv` is cast to `any` because KV/D1 are object bindings and
 * the generated `Env` type only exists after `wrangler types` runs; string
 * secrets keep an `import.meta.env` fallback for non-Cloudflare local runs.
 */

import { env as cfEnv } from 'cloudflare:workers';
import type { ChatEnv } from './core';

export function getChatEnv(): ChatEnv {
  const e = cfEnv as unknown as Record<string, unknown>;
  return {
    OPENROUTER_API_KEY:
      (e.OPENROUTER_API_KEY as string | undefined) ?? import.meta.env.OPENROUTER_API_KEY,
    RATE_LIMIT_KV: e.RATE_LIMIT_KV as ChatEnv['RATE_LIMIT_KV'],
    CHAT_DB: e.CHAT_DB as ChatEnv['CHAT_DB'],
    TELEGRAM_BOT_TOKEN:
      (e.TELEGRAM_BOT_TOKEN as string | undefined) ?? import.meta.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID:
      (e.TELEGRAM_CHAT_ID as string | undefined) ?? import.meta.env.TELEGRAM_CHAT_ID,
    TELEGRAM_WEBHOOK_SECRET:
      (e.TELEGRAM_WEBHOOK_SECRET as string | undefined) ?? import.meta.env.TELEGRAM_WEBHOOK_SECRET,
    CHATBOT_TURNSTILE_SECRET_KEY:
      (e.CHATBOT_TURNSTILE_SECRET_KEY as string | undefined) ??
      import.meta.env.CHATBOT_TURNSTILE_SECRET_KEY,
  };
}
