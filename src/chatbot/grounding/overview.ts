/**
 * Inventory overview grounding — always-on, cheap, deterministic.
 * ------------------------------------------------------------------
 * Queries the ACTIVE listings (PUBLIC fields only — never `dealerNotes`) and
 * computes compact roll-ups: total, price range, newest year, counts by the
 * reliably-populated `vehicleSpecs` dimensions, and price bands. Rendered to a
 * short plain-text block injected on every AI-reply turn so Rebi can answer
 * breadth questions ("do you have SUVs?", "how many under $30k?") and so a
 * lookup miss is never "blind".
 *
 * Deterministic (no LLM), fail-open, KV TTL-cached when a namespace is bound.
 */
import { client } from '../../sanity/lib/client';
import { getDealerConfig } from '../../config/dealer';
import { formatPrice } from '../../lib/listing';
import { cachedText } from './cache';
import type { KVNamespaceLike } from '../core';

interface OverviewRow {
  price?: number;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  condition?: string;
  year?: number;
}

// Compact projection — public fields only. No dealerNotes, no images, no prose.
const OVERVIEW_QUERY = `*[_type == "listing" && category == "automotive" && status == "active"]{
  price,
  "bodyType": vehicleSpecs.bodyType,
  "fuelType": vehicleSpecs.fuelType,
  "transmission": vehicleSpecs.transmission,
  "driveType": vehicleSpecs.driveType,
  "condition": vehicleSpecs.condition,
  "year": vehicleSpecs.year
}`;

/** Count occurrences of a field, render "code n, code n" ordered by count desc. */
function tally(rows: OverviewRow[], key: keyof OverviewRow): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === '') continue;
    const code = String(v);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} ${n}`)
    .join(', ');
}

/** Build "under $X", in-between ranges, and "over $last" band counts. */
function priceBandLine(rows: OverviewRow[], bands: readonly number[], currency: string): string {
  const priced = rows.map((r) => r.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (!priced.length || !bands.length) return '';
  const sorted = [...bands].sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = 0;
  for (let i = 0; i < sorted.length; i++) {
    const hi = sorted[i];
    const n = priced.filter((p) => p > prev && p <= hi).length;
    const label = i === 0 ? `under ${formatPrice(hi, currency)}` : `${formatPrice(prev, currency)}–${formatPrice(hi, currency)}`;
    parts.push(`${label}: ${n}`);
    prev = hi;
  }
  const over = priced.filter((p) => p > prev).length;
  parts.push(`over ${formatPrice(prev, currency)}: ${over}`);
  return parts.join(', ');
}

function renderOverview(rows: OverviewRow[]): string {
  const cfg = getDealerConfig();
  const currency = cfg.locale.currency;
  const total = rows.length;

  if (total === 0) {
    return [
      '=== INVENTORY OVERVIEW (live snapshot) ===',
      'There are currently no active vehicles in stock. Tell the visitor the lot is empty right now and point them to /listings or the team — do not invent stock.',
      '=== END INVENTORY OVERVIEW ===',
    ].join('\n');
  }

  const priced = rows.map((r) => r.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const years = rows.map((r) => r.year).filter((y): y is number => typeof y === 'number');

  const lines = ['=== INVENTORY OVERVIEW (live snapshot) ===', `Total active vehicles: ${total}`];
  if (priced.length) {
    lines.push(`Price range: ${formatPrice(Math.min(...priced), currency)} – ${formatPrice(Math.max(...priced), currency)}`);
  }
  if (years.length) lines.push(`Newest model year: ${Math.max(...years)}`);

  const body = tally(rows, 'bodyType');
  if (body) lines.push(`Body types: ${body}`);
  const fuel = tally(rows, 'fuelType');
  if (fuel) lines.push(`Fuel: ${fuel}`);
  const trans = tally(rows, 'transmission');
  if (trans) lines.push(`Transmission: ${trans}`);
  const drive = tally(rows, 'driveType');
  if (drive) lines.push(`Drive: ${drive}`);
  const cond = tally(rows, 'condition');
  if (cond) lines.push(`Condition: ${cond}`);

  const bandLine = priceBandLine(rows, cfg.chat.grounding.overview.priceBands, currency);
  if (bandLine) lines.push(`Price bands: ${bandLine}`);

  lines.push(
    'These are roll-up counts of the whole active lot. Use them for breadth questions; for specific vehicles rely on the LIVE INVENTORY MATCHES block when present, and never quote a price or spec not shown to you.',
  );
  lines.push('=== END INVENTORY OVERVIEW ===');
  return lines.join('\n');
}

/**
 * Render the always-on inventory overview. KV TTL-cached when `kv` is bound.
 * Returns `null` on any error (the caller then marks live inventory unavailable
 * and shows a degraded sentinel).
 */
export async function getInventoryOverview(kv?: KVNamespaceLike): Promise<string | null> {
  const cfg = getDealerConfig().chat.grounding;
  try {
    return await cachedText(kv, 'grounding:overview:v1', cfg.cacheTtlSeconds.overview, async () => {
      const rows = await client.fetch<OverviewRow[]>(OVERVIEW_QUERY);
      return renderOverview(rows ?? []);
    });
  } catch (err) {
    console.error('[grounding] Inventory overview failed', err);
    return null;
  }
}
