/**
 * URL-driven inventory filtering — the single source of truth for the homepage
 * filter feature. Both the SSR homepage (`src/pages/index.astro`) and the
 * fetch-swap partial (`src/pages/partials/inventory.astro`) use this module so
 * the filter/query logic can't drift between them.
 *
 * ── URL CONTRACT ────────────────────────────────────────────────────────────
 * Param names were chosen to avoid collisions with existing site params
 * (`ids` on /compare, plus API-only `sessionId`/`afterId`).
 *
 * • Ranges use a SEPARATE min/max convention (readable, either side omittable,
 *   no delimiter parsing): `priceMin`, `priceMax`, `yearMin`, `yearMax`, and
 *   `odoMax` (odometer is max-only).
 * • Multi-select dimensions use a COMMA-SEPARATED convention, matching the
 *   site's existing `?ids=a,b,c` on /compare: `bodyType`, `transmission`,
 *   `fuelType`, `driveType`, `condition`, `seats`. (Parsing also accepts
 *   repeated params, e.g. `bodyType=suv&bodyType=sedan`, so a no-JS <form> GET
 *   still works; canonical serialization always emits the comma form.)
 * • `sort` is a fixed whitelist (see SORT_CLAUSES); default resolves from the
 *   dealer config, never hardcoded here.
 * • `page` is a 1-based integer; page size comes from the dealer config.
 * • Unknown/malformed values fall through to a no-op — never a silent guess.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { LISTING_FIELDS, type Listing } from './listing';
import { dealerConfig, type SortKey } from '../config/dealer';

// --- Canonical enum code sets (mirror the Sanity vehicleSpecs schema) ---------
// The enum VALUES are schema-derived (see src/sanity/schemaTypes/listing.ts) and
// double as URL param values. Which body types a dealer SHOWS is dealer config
// (dealerConfig.inventory.bodyTypes); the other enums are shown in full.
// Full vehicleSpecs.bodyType enum (the schema's complete set). Which of these a
// given dealer SHOWS is a subset in dealerConfig.inventory.bodyTypes; this is the
// canonical full list, used e.g. by the AI-search extraction schema.
export const BODY_TYPE_CODES = [
  'sedan',
  'hatchback',
  'suv',
  'ute',
  'wagon',
  'van',
  'coupe',
  'convertible',
] as const;
export const TRANSMISSION_CODES = ['auto', 'manual'] as const;
export const FUEL_TYPE_CODES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg'] as const;
export const DRIVE_TYPE_CODES = ['2wd', 'awd', '4wd'] as const;
export const CONDITION_CODES = ['new', 'used', 'demo'] as const;
// The sort whitelist as a runtime array (keys of SORT_CLAUSES). Mirrors the
// SortKey union in config/dealer.ts; the `satisfies` check fails the build if the
// two ever drift.
export const SORT_KEYS = ['newest', 'price-asc', 'price-desc', 'year-desc', 'odo-asc'] as const satisfies readonly SortKey[];
// Common seat counts offered in the UI. A universal vehicle attribute, not a
// dealer-brand value — kept here (shared lib) rather than in a component.
export const SEAT_OPTIONS = [2, 4, 5, 7, 8] as const;

// Sort key → GROQ order clause. Fixed whitelist; values come only from here, so
// interpolating the clause into the query string is safe (not user input).
const SORT_CLAUSES: Record<SortKey, string> = {
  newest: 'listingDate desc',
  'price-asc': 'price asc',
  'price-desc': 'price desc',
  'year-desc': 'vehicleSpecs.year desc',
  'odo-asc': 'vehicleSpecs.odometer asc',
};

// --- Types -------------------------------------------------------------------

export interface FilterState {
  sort: SortKey;
  bodyType: string[];
  transmission: string[];
  fuelType: string[];
  driveType: string[];
  condition: string[];
  seats: number[];
  priceMin?: number;
  priceMax?: number;
  yearMin?: number;
  yearMax?: number;
  odoMax?: number;
  page: number;
}

// --- Parsing -----------------------------------------------------------------

/** Split a multi-select param on commas AND across repeated occurrences, then
 *  keep only allowed codes (dedup, order-preserving). */
function parseMulti(sp: URLSearchParams, key: string, allowed: readonly string[]): string[] {
  const raw = sp.getAll(key).flatMap((v) => v.split(','));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const code = v.trim().toLowerCase();
    if (allowed.includes(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** Parse a non-negative integer param; returns undefined if absent/invalid. */
function parseInt0(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key);
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

export function parseFilters(sp: URLSearchParams): FilterState {
  const sortRaw = sp.get('sort');
  const sort: SortKey =
    sortRaw && sortRaw in SORT_CLAUSES ? (sortRaw as SortKey) : dealerConfig.inventory.defaultSort;

  const seatsRaw = sp.getAll('seats').flatMap((v) => v.split(','));
  const seats = [
    ...new Set(
      seatsRaw
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && (SEAT_OPTIONS as readonly number[]).includes(n)),
    ),
  ];

  const pageRaw = Number(sp.get('page'));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return {
    sort,
    bodyType: parseMulti(sp, 'bodyType', dealerConfig.inventory.bodyTypes),
    transmission: parseMulti(sp, 'transmission', TRANSMISSION_CODES),
    fuelType: parseMulti(sp, 'fuelType', FUEL_TYPE_CODES),
    driveType: parseMulti(sp, 'driveType', DRIVE_TYPE_CODES),
    condition: dealerConfig.inventory.showCondition
      ? parseMulti(sp, 'condition', CONDITION_CODES)
      : [],
    seats,
    priceMin: parseInt0(sp, 'priceMin'),
    priceMax: parseInt0(sp, 'priceMax'),
    yearMin: parseInt0(sp, 'yearMin'),
    yearMax: parseInt0(sp, 'yearMax'),
    odoMax: parseInt0(sp, 'odoMax'),
    page,
  };
}

// --- Query builder -----------------------------------------------------------

export interface InventoryResult {
  items: Listing[];
  total: number;
}

/**
 * Build the single listings GROQ query + its params object, reused by SSR and
 * any client re-fetch. All USER filter values are passed via the params object
 * ($bodyType, $priceMin, …) — never string-interpolated. Only the sort clause
 * (fixed whitelist) and the pagination slice bounds (computed integers) are
 * interpolated; neither is user-controlled, so neither is an injection vector.
 */
export function buildListingsQuery(state: FilterState): { query: string; params: Record<string, unknown> } {
  // Absent filters are passed as null so `defined($x)` short-circuits the clause
  // to true. (Referencing an undefined GROQ param is an error, so we always pass
  // every key.)
  const params: Record<string, unknown> = {
    bodyType: state.bodyType.length ? state.bodyType : null,
    transmission: state.transmission.length ? state.transmission : null,
    fuelType: state.fuelType.length ? state.fuelType : null,
    driveType: state.driveType.length ? state.driveType : null,
    condition: state.condition.length ? state.condition : null,
    seats: state.seats.length ? state.seats : null,
    priceMin: state.priceMin ?? null,
    priceMax: state.priceMax ?? null,
    yearMin: state.yearMin ?? null,
    yearMax: state.yearMax ?? null,
    odoMax: state.odoMax ?? null,
  };

  // The shared filter expression — used by both the page slice and the count so
  // the total always matches what's shown. Contains only $params + static paths.
  const filter = `_type == "listing" && category == "automotive"
    // Multi-tenant seam — see DECISION.md Decision 1/2. When multi-tenant lands,
    // uncomment to scope every query to the current dealer:
    // && dealer._ref == $dealerId
    && (!defined($bodyType) || vehicleSpecs.bodyType in $bodyType)
    && (!defined($transmission) || vehicleSpecs.transmission in $transmission)
    && (!defined($fuelType) || vehicleSpecs.fuelType in $fuelType)
    && (!defined($driveType) || vehicleSpecs.driveType in $driveType)
    && (!defined($condition) || vehicleSpecs.condition in $condition)
    && (!defined($seats) || vehicleSpecs.seatCount in $seats)
    && (!defined($priceMin) || price >= $priceMin)
    && (!defined($priceMax) || price <= $priceMax)
    && (!defined($yearMin) || vehicleSpecs.year >= $yearMin)
    && (!defined($yearMax) || vehicleSpecs.year <= $yearMax)
    && (!defined($odoMax) || vehicleSpecs.odometer <= $odoMax)`;

  const { pageSize } = dealerConfig.inventory;
  const offset = (state.page - 1) * pageSize;
  const end = offset + pageSize; // GROQ range slice is end-exclusive
  const order = SORT_CLAUSES[state.sort];

  const query = `{
    "items": *[${filter}]{ ${LISTING_FIELDS} } | order(${order}) [${offset}...${end}],
    "total": count(*[${filter}])
  }`;

  return { query, params };
}

// --- Serialization (URL is the single source of truth) -----------------------

/** Canonical query string for a filter state (defaults omitted). */
export function serializeFilters(state: FilterState): string {
  const sp = new URLSearchParams();
  if (state.sort !== dealerConfig.inventory.defaultSort) sp.set('sort', state.sort);
  if (state.priceMin != null) sp.set('priceMin', String(state.priceMin));
  if (state.priceMax != null) sp.set('priceMax', String(state.priceMax));
  if (state.yearMin != null) sp.set('yearMin', String(state.yearMin));
  if (state.yearMax != null) sp.set('yearMax', String(state.yearMax));
  if (state.odoMax != null) sp.set('odoMax', String(state.odoMax));
  if (state.bodyType.length) sp.set('bodyType', state.bodyType.join(','));
  if (state.transmission.length) sp.set('transmission', state.transmission.join(','));
  if (state.fuelType.length) sp.set('fuelType', state.fuelType.join(','));
  if (state.driveType.length) sp.set('driveType', state.driveType.join(','));
  if (state.seats.length) sp.set('seats', state.seats.join(','));
  if (state.condition.length) sp.set('condition', state.condition.join(','));
  if (state.page > 1) sp.set('page', String(state.page));
  return sp.toString();
}

/** Path (`/?…` or `/`) for a filter state — for links and history.pushState. */
export function hrefFor(state: FilterState): string {
  const qs = serializeFilters(state);
  return qs ? `/?${qs}` : '/';
}

// --- Pagination --------------------------------------------------------------

export function totalPages(total: number): number {
  return Math.max(1, Math.ceil(total / dealerConfig.inventory.pageSize));
}

/** Href for a given page number, preserving all active filters. */
export function pageHref(state: FilterState, page: number): string {
  return hrefFor({ ...state, page });
}

// --- Active-filter chips -----------------------------------------------------

const DIMENSION_LABELS: Record<string, string> = {
  bodyType: 'Body',
  transmission: 'Transmission',
  fuelType: 'Fuel',
  driveType: 'Drive',
  condition: 'Condition',
  seatCount: 'Seats',
  price: 'Price',
  year: 'Year',
  odometer: 'Odometer',
};

// Codes whose display label isn't just a title-cased version of the code.
const VALUE_LABELS: Record<string, Record<string, string>> = {
  transmission: { auto: 'Automatic', manual: 'Manual' },
  driveType: { '2wd': '2WD', awd: 'AWD', '4wd': '4WD' },
};

function titleCase(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/** Human label for an enum code within a dimension. Exported for the drawer UI. */
export function codeLabel(dimension: string, code: string): string {
  return VALUE_LABELS[dimension]?.[code] ?? titleCase(code);
}

function fmtNumber(n: number): string {
  return n.toLocaleString(dealerConfig.locale.locale);
}

function fmtPrice(n: number): string {
  return new Intl.NumberFormat(dealerConfig.locale.locale, {
    style: 'currency',
    currency: dealerConfig.locale.currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export interface FilterChip {
  key: string;
  label: string;
  value: string;
  removeHref: string;
}

/**
 * Active filters as removable chips. Removing a chip clears just that filter (a
 * single value for multi-selects; both bounds for a range) and resets to page 1.
 * Sort is not shown as a chip. hrefs work without JS.
 */
export function activeChips(state: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  const multiDims: { dim: keyof FilterState; labelKey: string }[] = [
    { dim: 'bodyType', labelKey: 'bodyType' },
    { dim: 'transmission', labelKey: 'transmission' },
    { dim: 'fuelType', labelKey: 'fuelType' },
    { dim: 'driveType', labelKey: 'driveType' },
    { dim: 'condition', labelKey: 'condition' },
  ];

  for (const { dim, labelKey } of multiDims) {
    const values = state[dim] as string[];
    for (const code of values) {
      const next = {
        ...state,
        page: 1,
        [dim]: values.filter((v) => v !== code),
      } as FilterState;
      chips.push({
        key: `${dim}:${code}`,
        label: DIMENSION_LABELS[labelKey],
        value: codeLabel(labelKey, code),
        removeHref: hrefFor(next),
      });
    }
  }

  for (const seat of state.seats) {
    const next = { ...state, page: 1, seats: state.seats.filter((s) => s !== seat) };
    chips.push({
      key: `seats:${seat}`,
      label: DIMENSION_LABELS.seatCount,
      value: `${seat}`,
      removeHref: hrefFor(next),
    });
  }

  if (state.priceMin != null || state.priceMax != null) {
    const value =
      state.priceMin != null && state.priceMax != null
        ? `${fmtPrice(state.priceMin)} – ${fmtPrice(state.priceMax)}`
        : state.priceMin != null
          ? `From ${fmtPrice(state.priceMin)}`
          : `Up to ${fmtPrice(state.priceMax as number)}`;
    const next = { ...state, page: 1, priceMin: undefined, priceMax: undefined };
    chips.push({ key: 'price', label: DIMENSION_LABELS.price, value, removeHref: hrefFor(next) });
  }

  if (state.yearMin != null || state.yearMax != null) {
    const value =
      state.yearMin != null && state.yearMax != null
        ? `${state.yearMin} – ${state.yearMax}`
        : state.yearMin != null
          ? `From ${state.yearMin}`
          : `Up to ${state.yearMax}`;
    const next = { ...state, page: 1, yearMin: undefined, yearMax: undefined };
    chips.push({ key: 'year', label: DIMENSION_LABELS.year, value, removeHref: hrefFor(next) });
  }

  if (state.odoMax != null) {
    const next = { ...state, page: 1, odoMax: undefined };
    chips.push({
      key: 'odoMax',
      label: DIMENSION_LABELS.odometer,
      value: `Up to ${fmtNumber(state.odoMax)} km`,
      removeHref: hrefFor(next),
    });
  }

  return chips;
}

/** True when any filter (not sort/page) is active. */
export function hasActiveFilters(state: FilterState): boolean {
  return activeChips(state).length > 0;
}
