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
  // Long-form generation (Sanity descriptions). Quality matters more than cost.
  writing: {
    models: ['anthropic/claude-haiku-4-5'],
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
  },
  // Anything needing reliable JSON output. Haiku primary for calibrated
  // confidence on structured extraction: gemma-4-26b:free produced
  // false-negative clarifying-question responses on unambiguous single-attribute
  // queries (e.g. "Petrol" → low confidence + a needless clarifying question) —
  // a model capability limit, not a prompt gap. gemma retained as a free
  // fallback so a Haiku outage degrades gracefully rather than hard-erroring
  // (different labs → uncorrelated failures).
  structured: {
    models: ['anthropic/claude-haiku-4-5', 'google/gemma-4-26b-a4b-it:free'],
    defaultTemperature: 0,
    defaultMaxTokens: 2048,
  },
} as const satisfies Record<Capability, TierConfig>;
