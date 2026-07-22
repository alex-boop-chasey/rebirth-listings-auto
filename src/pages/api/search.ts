/**
 * AI natural-language search — extraction endpoint (Phase 2).
 *
 * POST { query: string, filters?: object } → SearchResponse (see
 * src/lib/ai-search/schema.ts). It ONLY interprets: it returns the extracted
 * filters, it never applies them (Phase 3 decides what to do with the result).
 *
 * Mirrors the chatbot route's conventions (thin wrapper, getChatEnv,
 * configureAI, CF-Connecting-IP, JSON Response helper). All AI goes through the
 * src/ai/ layer on the `structured` tier — no direct provider calls
 * (DECISION.md Decision 3).
 */
import type { APIRoute } from 'astro';
import { getChatEnv } from '~/chatbot/get-env';
import { configureAI, generateObject } from '~/ai';
import { APP_URL, APP_TITLE, REQUEST_TIMEOUT_MS } from '~/chatbot/config';
import { dealerConfig } from '~/config/dealer';
import {
  ExtractionSchema,
  toSearchResponse,
  fallbackResponse,
  normalizeCurrentFilters,
} from '~/lib/ai-search/schema';
import type { FilterState } from '~/lib/listings-query';
import { SYSTEM_PROMPT } from '~/lib/ai-search/prompt';
import { checkSearchRateLimit } from '~/lib/ai-search/rate-limit';

export const prerender = false; // dynamic route, not pre-rendered

const json = (body: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** Compact, model-facing view of the current filters — only active dimensions,
 *  no page/sort-default noise. */
function activeFilterSummary(fs: FilterState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of ['bodyType', 'transmission', 'fuelType', 'driveType', 'condition'] as const) {
    if (fs[k].length) o[k] = fs[k];
  }
  if (fs.seats.length) o.seats = fs.seats;
  for (const k of ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'odoMax'] as const) {
    if (fs[k] != null) o[k] = fs[k];
  }
  if (fs.sort !== dealerConfig.inventory.defaultSort) o.sort = fs.sort;
  return o;
}

export const POST: APIRoute = async ({ request }) => {
  const cfg = dealerConfig.ai.search;

  // Feature flag — a dealer can disable AI search without a deploy.
  if (!cfg.enabled) return json({ error: 'AI search is disabled.' }, 503);

  const env = getChatEnv();

  // Parse + validate the body BEFORE spending an AI call or a rate-limit slot.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const rawQuery = (body as { query?: unknown })?.query;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) return json({ error: 'Missing "query" (a non-empty string).' }, 400);
  if (query.length > cfg.maxQueryLength) {
    return json({ error: `Query too long (max ${cfg.maxQueryLength} characters).` }, 400);
  }

  const current = normalizeCurrentFilters((body as { filters?: unknown })?.filters);

  // Per-IP rate limiting (Cloudflare KV). Guard when unbound; fail OPEN so a KV
  // hiccup never blocks a real visitor.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT_KV) {
    try {
      const rl = await checkSearchRateLimit(env.RATE_LIMIT_KV, ip, cfg.rateLimit);
      if (!rl.allowed) {
        return json({ error: 'Search limit reached — please try again later.' }, 429, {
          'Retry-After': String(rl.retryAfterSeconds),
        });
      }
    } catch (err) {
      console.error('[ai-search] rate limit check failed (allowing request)', err);
    }
  }

  // If the AI layer can't be configured, degrade gracefully (never a 500).
  if (!env.OPENROUTER_API_KEY) {
    console.error('[ai-search] OPENROUTER_API_KEY not set — returning graceful fallback');
    return json(fallbackResponse('AI search is temporarily unavailable — please use the filters.'), 200);
  }
  configureAI({
    openrouterApiKey: env.OPENROUTER_API_KEY,
    referer: APP_URL,
    appTitle: APP_TITLE,
    attemptTimeoutMs: REQUEST_TIMEOUT_MS,
  });

  // One-shot structured extraction on the `structured` tier. User input is a
  // SEPARATE message block, delimited and marked untrusted in the system prompt.
  try {
    const { content } = await generateObject({
      capability: 'structured',
      schema: ExtractionSchema,
      schemaName: 'CarSearchExtraction',
      // The extraction JSON is small; cap output well under the tier's 2048
      // default. This is a per-request override, not a tier change — it trims cost
      // and latency for a bounded payload. (Tier/model choice stays in src/ai/.)
      maxTokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Current filters (JSON, may be empty): ${JSON.stringify(activeFilterSummary(current))}\n\n<user_query>\n${query}\n</user_query>`,
        },
      ],
    });
    return json(toSearchResponse(content), 200);
  } catch (err) {
    // Model failure / unparseable output / validation exhaustion → graceful 200.
    console.error('[ai-search] extraction failed', err);
    return json(fallbackResponse(), 200);
  }
};
