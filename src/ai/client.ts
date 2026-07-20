/**
 * Public entry points for the AI provider abstraction layer.
 *
 * Every AI feature calls one of these three functions; nothing in the app should
 * talk to OpenRouter (or any provider) directly once this layer is in use. All
 * three resolve the request's `capability` to a model list via `./tiers.ts` and
 * apply the layer's fallback semantics documented per-function below.
 *
 * Phase 1: signatures only. Every body throws — implementations arrive in a
 * later phase once the provider adapters exist under `./providers/`.
 */

import type { z } from 'zod';
import type { AIRequest, AIResponse, AIStreamChunk } from './types';

const NOT_IMPLEMENTED = 'not implemented in phase 1';

/**
 * Generate a plain-text completion.
 *
 * Fallback semantics: tries the tier's models in order. A retryable provider
 * failure advances to the next model; a non-retryable one still advances (the
 * next model may not share the fault) but is recorded. If every model fails,
 * throws `AllModelsExhaustedError` carrying the per-model attempt log. The
 * `modelUsed` on the returned response is the model that actually succeeded.
 */
export async function generate(req: AIRequest): Promise<AIResponse<string>> {
  void req;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Generate a structured object validated against a Zod schema.
 *
 * Fallback semantics: same per-model fallback as `generate`. Additionally, for
 * each model the raw output is parsed against `schema`; on a parse/validation
 * failure the layer makes exactly **one** repair attempt (re-prompting the same
 * model with the validation error) before moving on. If output still cannot be
 * validated after that repair, throws `StructuredParseError` with the raw text
 * (and `schemaName` when supplied). If all models are exhausted first, throws
 * `AllModelsExhaustedError`.
 */
export async function generateObject<T>(
  req: AIRequest & { schema: z.ZodType<T>; schemaName?: string }
): Promise<AIResponse<T>> {
  void req;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Stream a plain-text completion chunk-by-chunk.
 *
 * Fallback semantics differ from the non-streaming path because tokens are
 * handed to the caller as they arrive and cannot be un-sent:
 *
 * - If a model fails **before emitting its first token**, the layer silently
 *   restarts the stream on the next model in the tier — the caller sees an
 *   uninterrupted stream and never learns a restart happened.
 * - If a model fails **after at least one token has been emitted**, the layer
 *   does NOT restart (that would duplicate/replay text). It throws
 *   `StreamInterruptedError` carrying the `partialContent` emitted so far and
 *   the `modelUsed`, so the caller can decide how to recover.
 * - If every model fails before emitting a token, throws
 *   `AllModelsExhaustedError`.
 *
 * The final chunk (`done: true`) carries `modelUsed` and, when the provider
 * reports it, `tokensUsed`.
 */
export function generateStream(req: AIRequest): AsyncIterable<AIStreamChunk> {
  void req;
  throw new Error(NOT_IMPLEMENTED);
}
