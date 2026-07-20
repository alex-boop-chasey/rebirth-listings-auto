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
  // High-volume buyer-facing chat. Free models only — matches the current
  // chatbot's primary→fallback pair (gpt-oss-20b → hermes-3).
  'chat-cheap': {
    models: [
      'openai/gpt-oss-20b:free',
      'nousresearch/hermes-3-llama-3.1-405b:free',
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
  // Anything needing reliable JSON output.
  structured: {
    models: ['anthropic/claude-haiku-4-5'],
    defaultTemperature: 0,
    defaultMaxTokens: 2048,
  },
} as const satisfies Record<Capability, TierConfig>;
