/**
 * AI-search extraction schema + FilterState converter.
 *
 * This is the contract Phase 3 depends on. The LLM emits an enum-constrained
 * `Extraction`; deterministic code here converts its filters into a Phase 1
 * `FilterState` (the exact shape the URL contract already accepts). The model
 * only INTERPRETS — it cannot invent a filter value, because every enum field is
 * validated against the exact vehicleSpecs codes and REJECTED (not coerced) if
 * out of range.
 *
 * Enum code sets are imported from listings-query.ts (which mirrors the Sanity
 * vehicleSpecs schema) — never duplicated here.
 */
import { z } from 'zod';
import {
  BODY_TYPE_CODES,
  TRANSMISSION_CODES,
  FUEL_TYPE_CODES,
  DRIVE_TYPE_CODES,
  CONDITION_CODES,
  SORT_KEYS,
  parseFilters,
  type FilterState,
} from '../listings-query';

// Re-export the enum sets so the prompt builder reads them from one place.
export {
  BODY_TYPE_CODES,
  TRANSMISSION_CODES,
  FUEL_TYPE_CODES,
  DRIVE_TYPE_CODES,
  CONDITION_CODES,
  SORT_KEYS,
} from '../listings-query';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

// --- AI-facing filter shape --------------------------------------------------
// What the LLM is allowed to emit. Enum arrays are constrained to the EXACT
// vehicleSpecs codes (z.enum rejects anything else — no coercion). Numeric fields
// are bounded but not enums. `sort` is an optional interpretation hint
// ("cheapest" → price-asc); page/sort bookkeeping otherwise stays out of the AI's
// hands. Unknown keys are stripped (Zod default), so a chatty model doesn't fail
// validation over an extra field — only bad ENUM VALUES are rejected.
export const AiFiltersSchema = z.object({
  bodyType: z.array(z.enum(BODY_TYPE_CODES)).default([]),
  transmission: z.array(z.enum(TRANSMISSION_CODES)).default([]),
  fuelType: z.array(z.enum(FUEL_TYPE_CODES)).default([]),
  driveType: z.array(z.enum(DRIVE_TYPE_CODES)).default([]),
  condition: z.array(z.enum(CONDITION_CODES)).default([]),
  seats: z.array(z.number().int().positive()).default([]),
  priceMin: z.number().int().nonnegative().nullable().default(null),
  priceMax: z.number().int().nonnegative().nullable().default(null),
  yearMin: z.number().int().nullable().default(null),
  yearMax: z.number().int().nullable().default(null),
  odoMax: z.number().int().nonnegative().nullable().default(null),
  sort: z.enum(SORT_KEYS).nullable().default(null),
});
export type AiFilters = z.infer<typeof AiFiltersSchema>;

// --- The full extraction the LLM returns -------------------------------------
export const ExtractionSchema = z.object({
  interpretation: z.string().min(1).max(400),
  confidence: z.enum(CONFIDENCE_LEVELS),
  clarifyingQuestion: z.string().min(1).max(300).nullable(),
  filters: AiFiltersSchema,
  matchReasons: z.array(z.string().min(1).max(60)).max(5).default([]),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// --- Endpoint response shape (the Phase 3 contract) --------------------------
export interface SearchResponse {
  /** One-sentence plain-English readback of what the AI understood. */
  interpretation: string;
  confidence: Confidence;
  /** Non-null → chat asks this before applying filters; null → apply immediately. */
  clarifyingQuestion: string | null;
  /** The filter payload, ready to serialize into the Phase 1 URL. */
  filters: FilterState;
  /** 3–5 short factual phrases → "matches because" chips in Phase 3. */
  matchReasons: string[];
}

/** An empty, valid FilterState (default sort, page 1) — identical to a Phase 1
 *  parse of an empty query string. */
export function emptyFilterState(): FilterState {
  return parseFilters(new URLSearchParams());
}

/**
 * Convert the LLM's enum-validated filters into a Phase 1 FilterState.
 *
 * Built by writing the extraction into a URLSearchParams and running Phase 1's
 * own `parseFilters` — so the result is BY CONSTRUCTION byte-identical to what a
 * hard SSR load of the equivalent URL would produce (same enum/dealer-subset
 * validation, same defaults). This is the exact, total one-to-one mapping Phase 3
 * relies on; there is no parallel filter type.
 */
export function toFilterState(f: AiFilters): FilterState {
  const sp = new URLSearchParams();
  const setMulti = (key: string, arr: readonly (string | number)[]) => {
    if (arr.length) sp.set(key, arr.join(','));
  };
  setMulti('bodyType', f.bodyType);
  setMulti('transmission', f.transmission);
  setMulti('fuelType', f.fuelType);
  setMulti('driveType', f.driveType);
  setMulti('condition', f.condition);
  setMulti('seats', f.seats);
  if (f.priceMin != null) sp.set('priceMin', String(f.priceMin));
  if (f.priceMax != null) sp.set('priceMax', String(f.priceMax));
  if (f.yearMin != null) sp.set('yearMin', String(f.yearMin));
  if (f.yearMax != null) sp.set('yearMax', String(f.yearMax));
  if (f.odoMax != null) sp.set('odoMax', String(f.odoMax));
  if (f.sort) sp.set('sort', f.sort);
  return parseFilters(sp);
}

/**
 * Build the final endpoint response from a validated extraction, enforcing the
 * invariant that LOW confidence must always carry a clarifying question
 * (confidence rules live beside the prompt in prompt.ts).
 */
export function toSearchResponse(ex: Extraction): SearchResponse {
  const clarifyingQuestion =
    ex.confidence === 'low' && !ex.clarifyingQuestion
      ? "Could you tell me a bit more about what you're after — a budget, body type, or fuel type?"
      : ex.clarifyingQuestion;
  return {
    interpretation: ex.interpretation,
    confidence: ex.confidence,
    clarifyingQuestion,
    filters: toFilterState(ex.filters),
    matchReasons: ex.matchReasons,
  };
}

/**
 * Graceful "couldn't understand" response, returned with HTTP 200 whenever the
 * model fails, its output can't be parsed/validated, or the AI layer is
 * unavailable — never a 500.
 */
export function fallbackResponse(interpretation?: string): SearchResponse {
  return {
    interpretation:
      interpretation ??
      'I couldn’t understand that clearly — try rephrasing, e.g. "hybrid SUV under $40k".',
    confidence: 'low',
    clarifyingQuestion:
      "Could you rephrase what you're looking for — for example a budget, body type, or fuel type?",
    filters: emptyFilterState(),
    matchReasons: [],
  };
}

/**
 * Leniently coerce an untrusted client-provided "current filters" object (from
 * the request body) into a FilterState, for prompt context on refinement queries.
 * Anything unrecognized is dropped by parseFilters — garbage in, valid out.
 */
export function normalizeCurrentFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return emptyFilterState();
  const r = raw as Record<string, unknown>;
  const sp = new URLSearchParams();
  for (const k of ['bodyType', 'transmission', 'fuelType', 'driveType', 'condition', 'seats']) {
    const v = r[k];
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.map(String).join(','));
    } else if (typeof v === 'string' && v.trim() !== '') {
      sp.set(k, v);
    }
  }
  for (const k of ['priceMin', 'priceMax', 'yearMin', 'yearMax', 'odoMax']) {
    const v = r[k];
    if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) sp.set(k, String(v));
  }
  if (typeof r.sort === 'string') sp.set('sort', r.sort);
  return parseFilters(sp);
}
