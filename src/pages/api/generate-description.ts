/**
 * AI listing-description generator — Studio-only endpoint.
 *
 * POST { listingId: string } → { description: PortableTextBlock[] } on success,
 * or { error: string } (HTTP 200) on any AI failure. Reads the DRAFT listing
 * server-side (title, category, vehicleSpecs, dealerNotes, image assets),
 * composes a prose prompt, and calls the `writing` tier via the src/ai/ layer
 * (DECISION.md Decision 3 — no direct provider calls). When the resolved primary
 * writing model supports vision AND the listing has photos, the photos are sent
 * as image parts; otherwise text-only.
 *
 * Mirrors /api/search.ts discipline: feature flag → cheap body validation →
 * per-IP KV rate limit (fail OPEN) → graceful degradation, never a 500 for AI
 * failure. Dealer-scoped values (enabled flag, rate limit, Studio origins, tone,
 * locale, name) all come from dealerConfig — nothing hardcoded here.
 */
import type { APIRoute } from 'astro';
import { configureAI, generate, TIERS, getModelCapabilities } from '~/ai';
import type { AIContentPart, AIMessage } from '~/ai';
import { APP_URL, APP_TITLE, REQUEST_TIMEOUT_MS } from '~/chatbot/config';
import { dealerConfig } from '~/config/dealer';
import { getDescriptionEnv } from '~/lib/generate-description/env';
import { fetchDraftListing } from '~/lib/generate-description/sanity-draft';
import { buildSystemPrompt, buildUserText, type DescriptionFacts } from '~/lib/generate-description/prompt';
import { plainTextToPortableText } from '~/lib/portable-text';
import { checkSearchRateLimit } from '~/lib/ai-search/rate-limit';
import { urlFor } from '~/sanity/lib/image';

export const prerender = false; // dynamic route, not pre-rendered

const json = (body: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

// Cap the number of photos sent on the vision path — bounds token cost/latency.
const MAX_IMAGES = 4;

export const POST: APIRoute = async ({ request }) => {
  const cfg = dealerConfig.ai.generateDescription;

  // Feature flag — a dealer can disable the button without a deploy.
  if (!cfg.enabled) return json({ error: 'Description generation is disabled.' }, 503);

  // Origin allowlist — this endpoint is only for the dealer's Studio.
  // TODO(multi-tenant): replace origin check with Studio session validation before real dealer data flows
  const origin = request.headers.get('Origin');
  if (!origin || !dealerConfig.ai.studioOrigins.includes(origin)) {
    return json({ error: 'Forbidden.' }, 403);
  }

  const env = getDescriptionEnv();

  // Parse + validate the body BEFORE spending a rate-limit slot or an AI call.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const rawId = (body as { listingId?: unknown })?.listingId;
  const listingId = typeof rawId === 'string' ? rawId.trim() : '';
  if (!listingId) return json({ error: 'Missing "listingId" (a non-empty string).' }, 400);

  // Per-IP rate limiting (Cloudflare KV). Guard when unbound; fail OPEN so a KV
  // hiccup never blocks a dealer clicking the button.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT_KV) {
    try {
      const rl = await checkSearchRateLimit(env.RATE_LIMIT_KV, ip, cfg.rateLimit, 'desc:');
      if (!rl.allowed) {
        return json({ error: 'Generation limit reached — please try again later.' }, 429, {
          'Retry-After': String(rl.retryAfterSeconds),
        });
      }
    } catch (err) {
      console.error('[generate-description] rate limit check failed (allowing request)', err);
    }
  }

  // Need both the AI key and a Sanity read token. Degrade gracefully (never 500).
  if (!env.OPENROUTER_API_KEY || !env.SANITY_TOKEN) {
    console.error('[generate-description] missing OPENROUTER_API_KEY or SANITY_TOKEN');
    return json({ error: 'Description generation is temporarily unavailable.' }, 200);
  }

  // Fetch the draft server-side.
  let draft;
  try {
    draft = await fetchDraftListing(env.SANITY_TOKEN, listingId);
  } catch (err) {
    console.error('[generate-description] draft fetch failed', err);
    return json({ error: 'Could not load the listing.' }, 200);
  }
  if (!draft) return json({ error: 'Listing not found.' }, 400);

  configureAI({
    openrouterApiKey: env.OPENROUTER_API_KEY,
    referer: APP_URL,
    appTitle: APP_TITLE,
    attemptTimeoutMs: REQUEST_TIMEOUT_MS,
  });

  // Compose the prompt from the draft's facts. Dealer name/tone/locale from config.
  const facts: DescriptionFacts = {
    title: draft.title ?? '(untitled)',
    category: draft.category ?? 'automotive',
    specs: draft.vehicleSpecs ?? {},
    dealerNotes: draft.dealerNotes ?? '',
  };
  const systemPrompt = buildSystemPrompt(dealerConfig.identity.name, dealerConfig.ai.descriptionVoice);
  const userText = buildUserText(facts);

  // Vision opt-out: send photos only when the RESOLVED PRIMARY writing model
  // supports vision AND the listing has image assets. If the tier falls through
  // to a fallback with different vision support, worst case is a text-only
  // result — acceptable (ticket).
  const primaryModel = TIERS.writing.models[0];
  const supportsVision = getModelCapabilities(primaryModel).supportsVision;
  const imageRefs = (draft.images ?? [])
    .map((i) => i.asset?._ref)
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .slice(0, MAX_IMAGES);

  let userContent: string | AIContentPart[];
  if (supportsVision && imageRefs.length) {
    const parts: AIContentPart[] = [{ type: 'text', text: userText }];
    for (const ref of imageRefs) {
      const url = urlFor(ref).width(1024).fit('max').url();
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
    userContent = parts;
  } else {
    userContent = userText;
  }

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // One-shot generation on the `writing` tier (prose, not structured JSON).
  try {
    const { content } = await generate({ capability: 'writing', messages });
    const description = plainTextToPortableText(content);
    if (!description.length) {
      return json({ error: 'The generated description was empty — please try again.' }, 200);
    }
    return json({ description }, 200);
  } catch (err) {
    // Both tier models exhausted / malformed output → graceful 200 with an error.
    console.error('[generate-description] generation failed', err);
    return json({ error: 'Could not generate a description right now — please try again.' }, 200);
  }
};
