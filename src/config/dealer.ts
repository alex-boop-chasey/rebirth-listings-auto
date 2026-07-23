/**
 * Central dealer configuration — THE MULTI-TENANT SEAM.
 *
 * See DECISION.md, Decision 1 ("Config as data, never hardcoded"). Every value
 * that a different dealership might want different lives here and is read at
 * runtime — never hardcoded in components, pages, scripts, or logic. Today this
 * object holds the one current dealer; later it becomes keyed by tenant ID
 * resolved server-side from the domain, and "the current dealer" resolves from
 * that. If you're about to type a dealer-specific literal into a component,
 * stop — add it here and read it instead.
 *
 * Consumed via the `~/config/dealer` alias (`~/*` → `src/*`).
 */

// A single dealer's configuration. When we go multi-tenant this becomes the
// per-tenant record shape; the resolver just picks which one is "current".
export interface DealerConfig {
  identity: {
    /** Display name for this dealer. */
    name: string;
  };
  /** Region/formatting settings — dealer- and region-specific. */
  locale: {
    /** BCP-47 locale used for number/price/date formatting (e.g. 'en-AU'). */
    locale: string;
    /** ISO-4217 currency code used as the default when a listing has none. */
    currency: string;
  };
  /**
   * Filter shape — "this dealer shows these dimensions / uses these bounds".
   * This is the knob a future tenant swap varies to change what the inventory
   * filter drawer offers, not what the drawer is technically capable of.
   */
  inventory: {
    /** How many vehicles this dealer shows per page. */
    pageSize: number;
    /** Default sort when the URL specifies none. Must be a SortKey. */
    defaultSort: SortKey;
    /** Upper bound (inclusive) of this dealer's price range control. */
    priceCap: number;
    /** Price steps this dealer offers in the price filter dropdowns (whole dollars). */
    priceOptions: readonly number[];
    /** Years this dealer offers in the year filter dropdowns (calendar years). */
    yearOptions: readonly number[];
    /** Odometer steps this dealer offers in the odometer filter dropdown (whole km). */
    odoOptions: readonly number[];
    /** Body types this dealer shows, in display order (subset of the schema enum). */
    bodyTypes: BodyTypeCode[];
    /** Whether this dealer surfaces the "condition" (new/used/demo) filter. */
    showCondition: boolean;
    /** Which filter dimensions appear for this dealer, in display order. */
    dimensions: FilterDimension[];
  };
  /** Labels / copy — the human-facing strings for this dealer. */
  copy: {
    /** Human labels for each sort option, keyed by SortKey. */
    sortLabels: Record<SortKey, string>;
  };
  /**
   * AI-feature settings — dealer-scoped toggles and limits only. The model
   * choice is owned centrally by src/ai/ capability tiers (DECISION.md
   * Decision 3) and the prompts are feature-scoped (src/lib/ai-search/); neither
   * belongs here.
   */
  ai: {
    /** Natural-language inventory search (Phase 2 extraction core onward). */
    search: {
      /** Master on/off — lets a dealer disable AI search without a deploy. */
      enabled: boolean;
      /** Per-IP rate limit for the search endpoint. Defaults mirror the chatbot. */
      rateLimit: { windowSeconds: number; maxRequests: number };
      /** Max accepted query length (chars); longer requests are rejected pre-AI. */
      maxQueryLength: number;
    };
  };
  /**
   * Hero AI search bar (Phase 3a) — dealer-scoped UI copy and typewriter timings.
   * Distinct from `ai.search` above (which is the backend endpoint's flag/limits):
   * this is purely the front-of-house presentation of the same feature.
   */
  aiSearch: {
    /** Cycling typewriter placeholder examples — realistic shopper phrases.
     *  Dealer-scoped: a luxury lot's examples differ from a used-car lot's. */
    placeholders: readonly string[];
    /** Copy on the subordinated link that opens the classic filter drawer. */
    fallbackLinkLabel: string;
    /** Copy shown under the readback once AI-extracted filters are applied to the grid. */
    appliedLabel: string;
    /** How long a fully-typed placeholder dwells before it starts deleting (ms). */
    typewriterDwellMs: number;
    /** Typing speed per character (ms). */
    typewriterTypeMs: number;
    /** Deleting speed per character (ms). */
    typewriterDeleteMs: number;
  };
}

// Sort options are a fixed whitelist (see src/lib/listings-query.ts for how each
// maps to a GROQ order clause). `newest` is the safe default.
export type SortKey = 'newest' | 'price-asc' | 'price-desc' | 'year-desc' | 'odo-asc';

// Body-type codes mirror the Sanity vehicleSpecs enum. Kept as a literal union so
// a config that lists an unknown code fails typecheck rather than at runtime.
export type BodyTypeCode =
  | 'sedan'
  | 'hatchback'
  | 'suv'
  | 'ute'
  | 'wagon'
  | 'van'
  | 'coupe'
  | 'convertible';

// The filter dimensions the drawer can render. `dimensions` above picks which of
// these a given dealer actually shows.
export type FilterDimension =
  | 'sort'
  | 'price'
  | 'year'
  | 'odometer'
  | 'bodyType'
  | 'transmission'
  | 'fuelType'
  | 'driveType'
  | 'seatCount'
  | 'condition';

export const dealerConfig: DealerConfig = {
  identity: {
    // Minimal stub — the broader migration of name/domain/contact out of pages
    // is a separate ticket. Only what this feature needs lives here today.
    name: 'Rebirth Listings Auto',
  },
  locale: {
    locale: 'en-AU',
    currency: 'AUD',
  },
  inventory: {
    pageSize: 12,
    defaultSort: 'newest',
    priceCap: 150000,
    // Price steps this dealer offers in the price dropdowns (whole dollars).
    priceOptions: [
      5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000, 75000, 100000, 150000,
    ],
    // Years this dealer offers, newest-first: 2000 → current calendar year.
    // Generated at module load so the upper bound advances automatically on each
    // redeploy — the component never reads the runtime clock itself.
    yearOptions: (() => {
      const years: number[] = [];
      for (let y = new Date().getFullYear(); y >= 2000; y--) years.push(y);
      return years;
    })(),
    // Odometer steps this dealer offers in the odometer dropdown (whole km).
    odoOptions: [10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000],
    bodyTypes: ['sedan', 'hatchback', 'suv', 'ute', 'wagon', 'van', 'coupe', 'convertible'],
    showCondition: true,
    dimensions: [
      'sort',
      'price',
      'year',
      'odometer',
      'bodyType',
      'transmission',
      'fuelType',
      'driveType',
      'seatCount',
      'condition',
    ],
  },
  copy: {
    sortLabels: {
      newest: 'Newest first',
      'price-asc': 'Price: low to high',
      'price-desc': 'Price: high to low',
      'year-desc': 'Year: newest',
      'odo-asc': 'Odometer: lowest',
    },
  },
  ai: {
    search: {
      enabled: true,
      // Defaults mirror the chatbot's limiter (RATE_LIMIT_MAX / _WINDOW_SECONDS).
      rateLimit: { windowSeconds: 3600, maxRequests: 10 },
      maxQueryLength: 500,
    },
  },
  aiSearch: {
    // Bundaberg used-car lot — realistic plain-English examples.
    placeholders: [
      'Family SUV with 7 seats under $40,000',
      'Reliable diesel ute for towing, low kms',
      'First car for my daughter, automatic, under $15k',
      'Something economical for the commute',
      'Late-model hybrid with under 50,000 km',
    ],
    fallbackLinkLabel: 'Or refine manually',
    appliedLabel: 'Applied to the grid below.',
    typewriterDwellMs: 2000,
    typewriterTypeMs: 40,
    typewriterDeleteMs: 25,
  },
};

/**
 * Resolve the current dealer's config. Today there is one dealer, so this is a
 * constant; when multi-tenant lands this takes the request/host and returns the
 * matching tenant record. Call this instead of importing `dealerConfig` directly
 * where you want to be forward-compatible with tenant resolution.
 */
export function getDealerConfig(): DealerConfig {
  return dealerConfig;
}
