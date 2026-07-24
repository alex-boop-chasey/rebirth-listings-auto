/**
 * Live inventory lookup grounding — specific turns only.
 * ------------------------------------------------------------------
 * DETERMINISTIC (no LLM) extraction of a `FilterState` from the visitor's
 * message via enum-code + synonym matching, then a live PUBLIC GROQ query for
 * the matching active vehicles. Renders a delimited, authoritative block of
 * ≤N one-liners + the exact total. Fail-open and KV short-TTL-cached.
 *
 * The extracted state is produced by feeding synthetic URL params through the
 * SAME `parseFilters` the URL filter contract uses, so a chat lookup and a
 * `/?bodyType=suv&priceMax=40000` link resolve to an identical `FilterState`.
 *
 * PUBLIC fields only — `dealerNotes` is never queried, projected, or rendered.
 */
import { client } from '../../sanity/lib/client';
import { getDealerConfig } from '../../config/dealer';
import { formatPrice } from '../../lib/listing';
import {
  parseFilters,
  buildListingsFilter,
  type FilterState,
} from '../../lib/listings-query';
import { cachedText } from './cache';
import type { KVNamespaceLike } from '../core';

// --- Synonym maps (buyer phrasing → canonical enum code) ----------------------
// Keys are matched as whole words (with an optional trailing plural "s").
const BODY_SYNONYMS: Record<string, string> = {
  sedan: 'sedan',
  hatch: 'hatchback',
  hatchback: 'hatchback',
  suv: 'suv',
  '4wd wagon': 'suv',
  ute: 'ute',
  pickup: 'ute',
  'pick-up': 'ute',
  wagon: 'wagon',
  estate: 'wagon',
  van: 'van',
  coupe: 'coupe',
  convertible: 'convertible',
  cabrio: 'convertible',
  cabriolet: 'convertible',
};
const TRANSMISSION_SYNONYMS: Record<string, string> = {
  auto: 'auto',
  automatic: 'auto',
  manual: 'manual',
  'stick shift': 'manual',
};
const FUEL_SYNONYMS: Record<string, string> = {
  petrol: 'petrol',
  unleaded: 'petrol',
  diesel: 'diesel',
  hybrid: 'hybrid',
  electric: 'electric',
  ev: 'electric',
  lpg: 'lpg',
  gas: 'lpg',
};
const DRIVE_SYNONYMS: Record<string, string> = {
  '2wd': '2wd',
  fwd: '2wd',
  rwd: '2wd',
  'two wheel drive': '2wd',
  awd: 'awd',
  'all wheel drive': 'awd',
  '4wd': '4wd',
  '4x4': '4wd',
  'four wheel drive': '4wd',
  'four-wheel drive': '4wd',
};
const CONDITION_SYNONYMS: Record<string, string> = {
  new: 'new',
  used: 'used',
  'second hand': 'used',
  'second-hand': 'used',
  'pre-owned': 'used',
  preowned: 'used',
  demo: 'demo',
  demonstrator: 'demo',
};

// Words we recognise as filter/qualifier vocabulary — excluded from the residual
// keyword so "diesel ute under 40k" yields no spurious title keyword.
const STOPWORDS = new Set([
  'do', 'you', 'have', 'has', 'got', 'any', 'the', 'a', 'an', 'is', 'are', 'im',
  'i', 'want', 'wanting', 'looking', 'look', 'for', 'some', 'me', 'show', 'whats',
  'what', 'whats', 'your', 'you', 'can', 'could', 'need', 'car', 'cars', 'vehicle',
  'vehicles', 'please', 'hi', 'hey', 'hello', 'there', 'with', 'and', 'or', 'that',
  'this', 'in', 'on', 'of', 'to', 'under', 'below', 'over', 'above', 'around',
  'about', 'less', 'more', 'than', 'up', 'max', 'min', 'budget', 'cheap', 'cheaper',
  'affordable', 'good', 'nice', 'best', 'great', 'family', 'newer', 'older', 'since',
  'from', 'before', 'after', 'between', 'model', 'models', 'seat', 'seats', 'seater',
  'km', 'kms', 'kilometre', 'kilometres', 'kilometer', 'kilometers', 'mile', 'miles',
  'mileage', 'low', 'high', 'price', 'priced', 'grand', 'k', 'something', 'anything',
  'stock', 'range', 'available', 'availability', 'inventory', 'lot', 'showroom',
  'yard', 'currently', 'now', 'right', 'today', 'listing', 'listings', 'sale',
]);

export interface Extraction {
  state: FilterState;
  keyword: string | null;
}

/** Parse a money/number token like "40k", "40,000", "35" (with `k` → *1000). */
function parseAmount(numeric: string, kSuffix: boolean): number {
  const n = Number(numeric.replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return kSuffix ? Math.round(n * 1000) : Math.round(n);
}

/** Collect canonical codes whose synonym appears as a whole word in `msg`. */
function matchCodes(msg: string, syn: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const [word, code] of Object.entries(syn)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // whole-word, optional trailing plural "s"
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?:$|[^a-z0-9])`, 'i');
    if (re.test(msg)) out.add(code);
  }
  return [...out];
}

/**
 * Deterministically extract a filter state + optional title keyword from a
 * visitor message. Returns `null` when nothing meaningful is found (the overview
 * alone then carries the turn).
 */
export function extractFilters(message: string): Extraction | null {
  const cfg = getDealerConfig().chat.grounding.lookup;
  const msg = ` ${message.toLowerCase()} `;

  const body = matchCodes(msg, BODY_SYNONYMS);
  const transmission = matchCodes(msg, TRANSMISSION_SYNONYMS);
  const fuelType = matchCodes(msg, FUEL_SYNONYMS);
  const driveType = matchCodes(msg, DRIVE_SYNONYMS);
  const condition = matchCodes(msg, CONDITION_SYNONYMS);

  const sp = new URLSearchParams();
  if (body.length) sp.set('bodyType', body.join(','));
  if (transmission.length) sp.set('transmission', transmission.join(','));
  if (fuelType.length) sp.set('fuelType', fuelType.join(','));
  if (driveType.length) sp.set('driveType', driveType.join(','));
  if (condition.length) sp.set('condition', condition.join(','));

  // --- Odometer ---------------------------------------------------------------
  // "low kms" / "low mileage" with no figure → configured ceiling.
  if (/\blow\s+(?:k|km|kms|kilometre|kilometres|kilometer|kilometers|mile|miles|mileage)/i.test(msg)) {
    sp.set('odoMax', String(cfg.lowKmThreshold));
  }
  // "<num> km" (optionally with under/below and a k suffix) → odometer ceiling.
  const odo = msg.match(
    /(\d[\d,]*)\s*(k)?\s*(?:km|kms|kilometre|kilometres|kilometer|kilometers|mile|miles)\b/i,
  );
  if (odo) {
    const v = parseAmount(odo[1], !!odo[2]);
    if (Number.isFinite(v)) sp.set('odoMax', String(v));
  }

  // --- Price ------------------------------------------------------------------
  // Requires a `$` prefix or a `k`/`grand` suffix so bare years/counts aren't
  // mistaken for prices. Qualifier decides min vs max; default (budget) = max.
  const priceRe =
    /(under|below|less than|up to|max|budget|around|over|above|more than|at least|from|min)?\s*\$?\s*(\d[\d,]*)\s*(k|grand)\b|(under|below|less than|up to|max|budget|around|over|above|more than|at least|from|min)?\s*\$\s*(\d[\d,]*)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = priceRe.exec(msg)) !== null) {
    const qualifier = (pm[1] ?? pm[4] ?? '').toLowerCase();
    const numeric = pm[2] ?? pm[5];
    const kSuffix = !!pm[3];
    if (!numeric) continue;
    const value = parseAmount(numeric, kSuffix);
    if (!Number.isFinite(value)) continue;
    const isMin = /^(over|above|more than|at least|from|min)$/.test(qualifier);
    if (isMin) sp.set('priceMin', String(value));
    else sp.set('priceMax', String(value));
  }

  // --- Year -------------------------------------------------------------------
  const nowYear = new Date().getFullYear();
  const yearMatch = msg.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    if (y >= 2000 && y <= nowYear) {
      const before = msg.slice(0, yearMatch.index ?? 0);
      if (/(newer|since|from|after)\s*$/.test(before)) sp.set('yearMin', String(y));
      else if (/(older|before)\s*$/.test(before)) sp.set('yearMax', String(y));
      else {
        // Bare model year → exact match.
        sp.set('yearMin', String(y));
        sp.set('yearMax', String(y));
      }
    }
  }

  // --- Seats ------------------------------------------------------------------
  const seatMatch = msg.match(/\b(\d)\s*(?:seat|seats|seater)\b/i);
  if (seatMatch) {
    sp.set('seats', seatMatch[1]);
  } else if (/\bfamily\b/i.test(msg)) {
    sp.set('seats', cfg.familySeats.join(','));
  }

  // parseFilters validates + drops unknown codes, giving the canonical state.
  const state = parseFilters(sp);

  const hasFilter =
    state.bodyType.length > 0 ||
    state.transmission.length > 0 ||
    state.fuelType.length > 0 ||
    state.driveType.length > 0 ||
    state.condition.length > 0 ||
    state.seats.length > 0 ||
    state.priceMin != null ||
    state.priceMax != null ||
    state.yearMin != null ||
    state.yearMax != null ||
    state.odoMax != null;

  // --- Residual keyword (make/model) ------------------------------------------
  // Only a fallback for bare make/model queries ("do you have a hilux?"). Never
  // layered on top of a structured filter, or a stray noun (e.g. "in stock")
  // would add a spurious `title match` clause that kills good structured matches.
  let keyword: string | null = null;
  if (cfg.keywordSearch && !hasFilter) {
    const residuals = message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    // Only trust residuals that weren't consumed as filter vocabulary.
    const known = new Set<string>([
      ...Object.keys(BODY_SYNONYMS),
      ...Object.keys(TRANSMISSION_SYNONYMS),
      ...Object.keys(FUEL_SYNONYMS),
      ...Object.keys(DRIVE_SYNONYMS),
      ...Object.keys(CONDITION_SYNONYMS),
    ].flatMap((w) => w.split(/[^a-z0-9]+/)));
    const candidates = residuals.filter((t) => !known.has(t) && !known.has(t.replace(/s$/, '')));
    if (candidates.length) keyword = candidates.slice(0, 2).join(' ');
  }

  if (!hasFilter && !keyword) return null;
  return { state, keyword };
}

// --- Live query + render ------------------------------------------------------

interface MatchRow {
  title?: string;
  price?: number;
  currency?: string;
  slug?: { current?: string };
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  year?: number;
  odometer?: number;
}

function renderMatchLine(r: MatchRow, i: number): string {
  const parts: string[] = [];
  if (r.year) parts.push(String(r.year));
  if (r.bodyType) parts.push(r.bodyType);
  if (r.fuelType) parts.push(r.fuelType);
  if (r.transmission) parts.push(r.transmission);
  if (typeof r.odometer === 'number') parts.push(`${r.odometer.toLocaleString('en-AU')} km`);
  const price = formatPrice(r.price ?? 0, r.currency ?? getDealerConfig().locale.currency);
  const spec = parts.length ? ` (${parts.join(', ')})` : '';
  return `${i + 1}. ${r.title ?? 'Vehicle'} — ${price}${spec}`;
}

function renderMatches(rows: MatchRow[], total: number, max: number): string {
  const header = '=== LIVE INVENTORY MATCHES (authoritative, fetched live) ===';
  const footer = '=== END LIVE INVENTORY MATCHES ===';
  if (total === 0 || rows.length === 0) {
    return [
      header,
      'No vehicles currently match that request. Tell the visitor plainly that nothing in stock matches right now, suggest broadening the search or checking /listings, and DO NOT invent alternatives, prices, or specs.',
      footer,
    ].join('\n');
  }
  const shown = rows.slice(0, max).map((r, i) => renderMatchLine(r, i));
  const note =
    total > rows.length
      ? `Showing ${rows.length} of ${total} matching vehicles.`
      : `${total} matching vehicle${total === 1 ? '' : 's'}.`;
  return [
    header,
    `${note} This list is the ONLY live stock matching the visitor's request. Do not quote any price or spec not shown here, and do not invent vehicles beyond this list. Point interested visitors to the listing on /listings or to the team.`,
    ...shown,
    footer,
  ].join('\n');
}

/**
 * Run the deterministic extraction + live query for the visitor's message.
 * Returns the rendered matches block, or `null` when nothing meaningful was
 * extracted (the overview carries the turn) or on any error (fail-open).
 * KV short-TTL-cached keyed by the normalized extraction.
 */
export async function getLiveMatches(kv: KVNamespaceLike | undefined, message: string): Promise<string | null> {
  const cfg = getDealerConfig().chat.grounding;
  if (!cfg.lookup.enabled) return null;

  let extraction: Extraction | null;
  try {
    extraction = extractFilters(message);
  } catch (err) {
    console.error('[grounding] Filter extraction failed', err);
    return null;
  }
  if (!extraction) return null;

  const { state, keyword } = extraction;
  const max = cfg.lookup.maxListings;

  try {
    return await cachedText(
      kv,
      `grounding:lookup:v1:${JSON.stringify({ state, keyword, max })}`,
      cfg.cacheTtlSeconds.lookup,
      async () => {
        const { filter, params } = buildListingsFilter(state);
        const kwClause = keyword ? ' && title match $kw' : '';
        const p: Record<string, unknown> = { ...params };
        if (keyword) p.kw = keyword.split(/\s+/).map((t) => `*${t}*`).join(' ');

        // Public projection only. Slice/count use the same active-scoped filter.
        const scoped = `${filter} && status == "active"${kwClause}`;
        const projection = `{
          title, price, currency, slug,
          "bodyType": vehicleSpecs.bodyType,
          "fuelType": vehicleSpecs.fuelType,
          "transmission": vehicleSpecs.transmission,
          "year": vehicleSpecs.year,
          "odometer": vehicleSpecs.odometer
        }`;
        const query = `{
          "items": *[${scoped}] | order(price asc) [0...${max}]${projection},
          "total": count(*[${scoped}])
        }`;

        const res = await client.fetch<{ items: MatchRow[]; total: number }>(query, p);
        return renderMatches(res?.items ?? [], res?.total ?? 0, max);
      },
    );
  } catch (err) {
    console.error('[grounding] Live lookup query failed', err);
    return null;
  }
}
