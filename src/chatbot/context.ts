/**
 * Rebirth Auto — Conversation Context (PORTABLE, zero-deps)
 * ==================================================================
 * The priming/context seam. A `ConversationContext` describes what surface a
 * visitor opened Rebi from (a specific listing, a compare drawer, a search) so
 * the server can ground the reply in that focus. It carries ONLY `{ kind, refs }`
 * — never any free text — so it can never be an injection vector: the primed
 * opening the widget shows is display-only and stays on the client.
 *
 * This module has ZERO dependencies (no Astro, no config import) so it moves
 * into any Fetch-API runtime unchanged, exactly like core.ts. The whitelist and
 * caps are passed in by the caller (which reads them from the dealer config),
 * keeping this file portable.
 */

/** The surfaces that can prime a conversation. `compare`/`search` are wired later. */
export type ConversationContextKind = 'listing' | 'compare' | 'search';

/**
 * A resolved, validated conversation context. `refs` are opaque identifiers
 * (Sanity `_id`s for `listing`) the server resolves against live data. No free
 * text ever rides along — the opening greeting is client-display-only.
 */
export interface ConversationContext {
  kind: ConversationContextKind;
  refs: string[];
}

export interface ParseContextOptions {
  /** Kinds this dealer accepts (from `chat.context.allowedKinds`). */
  allowedKinds: readonly string[];
  /** Hard cap on how many refs a context may carry (from `chat.context.maxRefs`). */
  maxRefs: number;
}

/**
 * Validate an untrusted `context` value off the wire into a `ConversationContext`
 * or `null`. Whitelists `kind`, keeps only string refs, trims/dedupes/caps them.
 * Returns `null` (→ no priming, fail-open) whenever the shape is unusable — an
 * unknown kind, a non-object, or no valid refs left after filtering.
 */
export function parseContext(raw: unknown, opts: ParseContextOptions): ConversationContext | null {
  if (!raw || typeof raw !== 'object') return null;

  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !opts.allowedKinds.includes(kind)) return null;

  const rawRefs = (raw as { refs?: unknown }).refs;
  if (!Array.isArray(rawRefs)) return null;

  const seen = new Set<string>();
  const refs: string[] = [];
  for (const r of rawRefs) {
    if (typeof r !== 'string') continue;
    const trimmed = r.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    refs.push(trimmed);
    if (refs.length >= opts.maxRefs) break;
  }
  if (refs.length === 0) return null;

  return { kind: kind as ConversationContextKind, refs };
}
