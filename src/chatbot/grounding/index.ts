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
import { resolveFocus } from './context';
import type { KVNamespaceLike } from '../core';
import type { ConversationContext } from '../context';

export async function buildGroundedSystemPrompt(
  kv: KVNamespaceLike | undefined,
  userMessage: string,
  context?: ConversationContext | null,
): Promise<string | null> {
  const cfg = getDealerConfig().chat;

  // Conversation focus is resolved INDEPENDENTLY of inventory grounding: a chat
  // primed from a listing should still be grounded on that vehicle even if the
  // dealer has broad inventory grounding turned off. Fail-open (null on miss).
  let focus: string | null = null;
  if (cfg.context.enabled && context) {
    focus = await resolveFocus(kv, context);
  }

  // Inventory grounding off: fall through to the static prompt, UNLESS a focus
  // was resolved — then produce a focus-only prompt (today's static base + the
  // primed vehicle). Returning null here would suppress priming (the bug the
  // critic flagged), so we key that decision on `focus`, not on grounding.
  if (!cfg.grounding.enabled) {
    return focus ? buildSystemPrompt({ focus }) : null;
  }

  const g = cfg.grounding;

  // Business facts always resolve to a usable string (doc → render, else static).
  const businessFacts = await getBusinessFacts(kv);

  // Inventory: the overview is the always-on backstop; its success defines
  // whether we have live inventory at all. The lookup is best-effort on top.
  let overview: string | null = null;
  let matches: string | null = null;

  if (g.overview.enabled) {
    overview = await getInventoryOverview(kv);
  }
  if (g.lookup.enabled) {
    matches = await getLiveMatches(kv, userMessage);
  }

  // "available" = we have at least one live inventory signal to trust. If both
  // came back null (fetch errors), the prompt shows the degraded sentinel.
  const available = overview !== null || matches !== null;

  return buildSystemPrompt({ businessFacts, overview, matches, available, focus });
}
