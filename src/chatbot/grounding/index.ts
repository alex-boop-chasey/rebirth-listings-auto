/**
 * Grounding orchestrator — assembles the live-grounded system prompt.
 * ------------------------------------------------------------------
 * Gathers the (deterministic, fail-open) grounding blocks — business facts,
 * inventory overview, and the per-turn live lookup — and hands them to the pure
 * `buildSystemPrompt(ctx)` builder. All Sanity/KV specifics live in the sibling
 * modules so `core.ts` stays close to portable and only needs this one call.
 *
 * NO LLM call happens here — extraction is keyword/enum matching. Every source
 * degrades independently: business facts fall back to the static knowledge, and
 * a failed inventory fetch flips `available` to false so the prompt shows a
 * degraded sentinel instead of stale/invented stock. Returns `null` only when
 * grounding is disabled by config, so the caller uses the plain static prompt.
 */
import { buildSystemPrompt } from '../system-prompt';
import { getDealerConfig } from '../../config/dealer';
import { getBusinessFacts } from './business-facts';
import { getInventoryOverview } from './overview';
import { getLiveMatches } from './lookup';
import type { KVNamespaceLike } from '../core';

export async function buildGroundedSystemPrompt(
  kv: KVNamespaceLike | undefined,
  userMessage: string,
): Promise<string | null> {
  const cfg = getDealerConfig().chat.grounding;
  if (!cfg.enabled) return null;

  // Business facts always resolve to a usable string (doc → render, else static).
  const businessFacts = await getBusinessFacts(kv);

  // Inventory: the overview is the always-on backstop; its success defines
  // whether we have live inventory at all. The lookup is best-effort on top.
  let overview: string | null = null;
  let matches: string | null = null;

  if (cfg.overview.enabled) {
    overview = await getInventoryOverview(kv);
  }
  if (cfg.lookup.enabled) {
    matches = await getLiveMatches(kv, userMessage);
  }

  // "available" = we have at least one live inventory signal to trust. If both
  // came back null (fetch errors), the prompt shows the degraded sentinel.
  const available = overview !== null || matches !== null;

  return buildSystemPrompt({ businessFacts, overview, matches, available });
}
