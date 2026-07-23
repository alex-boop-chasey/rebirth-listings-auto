/**
 * Public surface of the AI provider abstraction layer.
 *
 * Import AI functionality from `~/ai` (this barrel) — never reach into
 * `./providers/` from outside this folder; that path is internal to the layer.
 */

// Types (shapes)
export type {
  Capability,
  AIMessage,
  AIRequest,
  AIResponse,
  AIStreamChunk,
  FinishReason,
  TokenUsage,
  ProviderErrorKind,
} from './types';

// Error classes
export {
  AIError,
  AllModelsExhaustedError,
  StreamInterruptedError,
  StructuredParseError,
  ProviderError,
} from './types';

// Tier configuration (read-only) and its type
export { TIERS, MODEL_CAPABILITIES, getModelCapabilities } from './tiers';
export type { TierConfig } from './tiers';

// Runtime configuration seam
export { configureAI, getAIConfig, resetAIConfig } from './config';
export type { AIConfig } from './config';

// The three public functions
export { generate, generateObject, generateStream } from './client';
