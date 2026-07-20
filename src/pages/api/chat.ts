/**
 * Rebirth Listings Auto — Chat API route (Astro wrapper)
 * ------------------------------------------------------------------
 * THIN wrapper only. All logic lives in the portable handler at
 * `~/chatbot/core.ts`. Env is loaded via `~/chatbot/get-env.ts`, which reads
 * the `cloudflare:workers` module (Astro 7 / @astrojs/cloudflare v14 — the
 * `locals.runtime.env` pattern was removed).
 */

import type { APIRoute } from 'astro';
import { handleChatRequest } from '~/chatbot/core';
import { getChatEnv } from '~/chatbot/get-env';

export const prerender = false; // CRITICAL: dynamic route, not pre-rendered

export const POST: APIRoute = async ({ request }) => {
  return handleChatRequest(request, getChatEnv());
};
