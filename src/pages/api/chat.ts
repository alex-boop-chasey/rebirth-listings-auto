/**
 * Rebirth Auto — Chat API route (Astro wrapper)
 * ------------------------------------------------------------------
 * THIN wrapper only. All logic lives in the portable handler at
 * `~/chatbot/core.ts`. Env is loaded via `~/chatbot/get-env.ts`, which reads
 * the `cloudflare:workers` module (Astro 7 / @astrojs/cloudflare v14 — the
 * `locals.runtime.env` pattern was removed).
 */

import type { APIRoute } from 'astro';
import { handleChatRequest } from '~/chatbot/core';
import { getChatEnv } from '~/chatbot/get-env';
import { configureAI } from '~/ai';
import { APP_URL, APP_TITLE, REQUEST_TIMEOUT_MS } from '~/chatbot/config';

export const prerender = false; // CRITICAL: dynamic route, not pre-rendered

export const POST: APIRoute = async ({ request }) => {
  const env = getChatEnv();
  // The entry point owns the AI-layer config lifecycle (not core.ts). Called
  // once per request; the idempotency guard makes repeat calls with the same
  // values a no-op. Only configure when the key exists — otherwise core.ts's
  // own guard returns the "not configured" 500, preserving today's behaviour.
  if (env.OPENROUTER_API_KEY) {
    configureAI({
      openrouterApiKey: env.OPENROUTER_API_KEY,
      referer: APP_URL,
      appTitle: APP_TITLE,
      // Match the chatbot's existing per-attempt budget for parity.
      attemptTimeoutMs: REQUEST_TIMEOUT_MS,
      streamAttemptTimeoutMs: REQUEST_TIMEOUT_MS,
    });
  }
  return handleChatRequest(request, env);
};
