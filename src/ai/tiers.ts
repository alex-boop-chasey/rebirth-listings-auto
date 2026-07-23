/**
 * Capability → model mapping. The single place model ids for AI features live.
 *
 * Callers pass a `Capability`; the layer resolves it here to an ordered list of
 * concrete OpenRouter model ids. The first entry is the primary; the rest are
 * fallbacks tried in order. `defaultTemperature`/`defaultMaxTokens` supply the
 * per-tier request defaults, overridable per call via `AIRequest`.
 */

import type { Capability } from './types';

/** Configuration for a single capability tier. */
export interface TierConfig {
  /** Ordered model ids: primary first, then fallbacks. */
  models: readonly string[];
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

/**
 * The tier table. `as const satisfies Record<Capability, TierConfig>` keeps the
 * model-id strings literal-typed while still enforcing that every `Capability`
 * has exactly one entry (exhaustiveness) and each entry is a valid `TierConfig`.
 */
export const TIERS = {
  // High-volume buyer-facing chat. Free models only. Primary → fallback:
  // gpt-oss-20b → gemma-4-26b (hermes-3:free was discontinued on OpenRouter's
  // free tier; gemma-4 is a different lab/architecture, so failures are
  // uncorrelated with the primary).
  'chat-cheap': {
    models: [
      'openai/gpt-oss-20b:free',
      'google/gemma-4-26b-a4b-it:free',
    ],
    defaultTemperature: 0.7,
    defaultMaxTokens: 1024,
  },
  // TODO: reserved for future higher-reasoning chat — placeholder model only.
  'chat-quality': {
    models: ['anthropic/claude-haiku-4-5'],
  },
  // Long-form generation (Sanity descriptions).
  // Order matches `structured` — free primary while credits are dry; reorder to Haiku-primary is a one-line change per Decision 3.
  writing: {
    models: [
      'google/gemma-4-26b-a4b-it:free', // primary, free, works today
      'anthropic/claude-haiku-4-5',     // fallback, swap to primary after credit top-up
    ],
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
  },
  // Anything needing reliable JSON output. gemma-4-26b:free is primary right now
  // ONLY because OpenRouter has no credits for the paid tier — it is the only
  // working option, so the user-facing AI bar actually returns extractions. Haiku
  // is the INTENDED primary: it is better-calibrated on unambiguous
  // single-attribute queries (e.g. "Petrol", where gemma tends to over-ask for
  // clarification). Haiku is kept in the array as fallback so a future credit
  // top-up is a one-line REORDER (put Haiku first), not a re-add.
  structured: {
    models: ['google/gemma-4-26b-a4b-it:free', 'anthropic/claude-haiku-4-5'],
    defaultTemperature: 0,
    defaultMaxTokens: 2048,
  },
} as const satisfies Record<Capability, TierConfig>;

// Per-model capability metadata, keyed by OpenRouter model id. Kept as a parallel
// map (NOT folded into TierConfig.models) so the tier table's shape and client.ts's
// fallback loop are unchanged. Decision 3's provider layer stays purely additive.
export const MODEL_CAPABILITIES = {
  'google/gemma-4-26b-a4b-it:free': { supportsVision: true },
  'anthropic/claude-haiku-4-5': { supportsVision: true },
  'openai/gpt-oss-20b:free': { supportsVision: false },
} as const satisfies Record<string, { supportsVision: boolean }>;

/**
 * Resolve a model id's capability flags. Unknown ids default to text-only
 * (`supportsVision: false`) until a `MODEL_CAPABILITIES` entry proves otherwise.
 */
export function getModelCapabilities(modelId: string): { supportsVision: boolean } {
  return MODEL_CAPABILITIES[modelId as keyof typeof MODEL_CAPABILITIES] ?? { supportsVision: false };
}
