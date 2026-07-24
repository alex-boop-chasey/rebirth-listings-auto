/**
 * Conversation-focus grounding — the primed "Ask about this car" subject.
 * ------------------------------------------------------------------
 * Resolves the specific vehicle(s) a conversation was primed from into a
 * delimited, authoritative CONVERSATION FOCUS block, mirroring lookup.ts /
 * overview.ts: PUBLIC Sanity client, an EXPLICIT public projection (never
 * `dealerNotes`), `cachedText`, and fail-open (`null` on any error or miss).
 *
 * Deterministic (NO LLM call) — just a Sanity fetch by `_id`. Notes:
 *   - Resolves by `_id` via the token-free public client, so drafts (which live
 *     under a `drafts.` id the public client can't see) never surface.
 *   - Does NOT scope to `status == "active"`: a SOLD listing still resolves, so
 *     Rebi can honestly tell the visitor it's no longer available.
 */
import { client } from '../../sanity/lib/client';
import { getDealerConfig } from '../../config/dealer';
import { formatPrice } from '../../lib/listing';
import { cachedText } from './cache';
import type { KVNamespaceLike } from '../core';
import type { ConversationContext } from '../context';

interface FocusRow {
  _id?: string;
  title?: string;
  price?: number;
  currency?: string;
  status?: string;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  year?: number;
  odometer?: number;
  condition?: string;
  seatCount?: number;
}

// Public projection only — no dealerNotes, no images, no prose. Mirrors the
// shape lookup.ts renders, plus `status` so a sold vehicle reads honestly.
const FOCUS_PROJECTION = `{
  _id, title, price, currency, status,
  "bodyType": vehicleSpecs.bodyType,
  "fuelType": vehicleSpecs.fuelType,
  "transmission": vehicleSpecs.transmission,
  "driveType": vehicleSpecs.driveType,
  "year": vehicleSpecs.year,
  "odometer": vehicleSpecs.odometer,
  "condition": vehicleSpecs.condition,
  "seatCount": vehicleSpecs.seatCount
}`;

function renderFocusLine(r: FocusRow, i: number): string {
  const parts: string[] = [];
  if (r.year) parts.push(String(r.year));
  if (r.bodyType) parts.push(r.bodyType);
  if (r.fuelType) parts.push(r.fuelType);
  if (r.transmission) parts.push(r.transmission);
  if (r.driveType) parts.push(r.driveType);
  if (typeof r.seatCount === 'number') parts.push(`${r.seatCount} seats`);
  if (typeof r.odometer === 'number') parts.push(`${r.odometer.toLocaleString('en-AU')} km`);
  if (r.condition) parts.push(r.condition);
  const price = formatPrice(r.price ?? 0, r.currency ?? getDealerConfig().locale.currency);
  const spec = parts.length ? ` (${parts.join(', ')})` : '';
  const status = r.status && r.status !== 'active' ? ` — status: ${r.status.toUpperCase()}` : '';
  return `${i + 1}. ${r.title ?? 'Vehicle'} — ${price}${spec}${status}`;
}

/** Render the delimited focus block, or `''` when nothing resolved (→ omit). */
function renderFocus(rows: FocusRow[]): string {
  if (!rows.length) return '';
  const soldOrGone = rows.some((r) => r.status && r.status !== 'active');
  const header = '=== CONVERSATION FOCUS (the vehicle the visitor is looking at — authoritative, fetched live) ===';
  const footer = '=== END CONVERSATION FOCUS ===';
  const framing =
    'The visitor opened this chat from a specific vehicle. Treat it as the subject of the conversation unless they clearly move on to something else. The details below are fetched live from our stock system: never quote a price, spec, or availability that is not shown here, and never invent details.';
  const lines = rows.map((r, i) => renderFocusLine(r, i));
  const soldNote = soldOrGone
    ? 'One or more of these vehicles is no longer active (e.g. SOLD). If the visitor asks about it, tell them honestly it is no longer available and offer to help find something similar or connect them with our team.'
    : '';
  return [header, framing, ...lines, soldNote, footer].filter(Boolean).join('\n');
}

/**
 * Resolve a conversation context to its live CONVERSATION FOCUS block, or `null`
 * when priming is disabled, the kind isn't allowed, nothing resolves, or any
 * error occurs (fail-open — the focus is simply omitted). KV TTL-cached keyed by
 * the kind + refs.
 */
export async function resolveFocus(
  kv: KVNamespaceLike | undefined,
  context: ConversationContext,
): Promise<string | null> {
  const cfg = getDealerConfig().chat.context;
  if (!cfg.enabled) return null;
  if (!cfg.allowedKinds.includes(context.kind)) return null;

  const refs = context.refs.slice(0, cfg.maxRefs);
  if (!refs.length) return null;

  // v1 resolves `listing` refs by `_id`. Other kinds share this seam later
  // (compare = several ids, search = a query ref); until then they no-op.
  if (context.kind !== 'listing') return null;

  try {
    const text = await cachedText(
      kv,
      `grounding:focus:v1:${context.kind}:${refs.join(',')}`,
      cfg.cacheTtlSeconds,
      async () => {
        const query = `*[_type == "listing" && _id in $ids]${FOCUS_PROJECTION}`;
        const rows = await client.fetch<FocusRow[]>(query, { ids: refs });
        return renderFocus(rows ?? []);
      },
    );
    return text || null;
  } catch (err) {
    console.error('[grounding] Focus resolution failed (omitting focus)', err);
    return null;
  }
}
