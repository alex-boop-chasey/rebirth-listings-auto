/**
 * Public entry points for the AI provider abstraction layer.
 *
 * Every AI feature calls one of these three functions; nothing in the app should
 * talk to OpenRouter (or any provider) directly once this layer is in use. All
 * three resolve the request's `capability` to a model list via `./tiers.ts` and
 * apply the layer's fallback semantics documented per-function below.
 *
 * `generate()` and `generateObject()` are implemented (Phases 3–4).
 * `generateStream()` remains a scaffold until Phase 5.
 */

import { z } from 'zod';
import type { AIMessage, AIRequest, AIResponse, AIStreamChunk } from './types';
import { AllModelsExhaustedError, ProviderError, StructuredParseError } from './types';
import { TIERS, type TierConfig } from './tiers';
import { getAIConfig, type ResolvedAIConfig } from './config';
import { openrouterComplete, type OpenRouterCallOptions } from './providers/openrouter';
import { buildRepairMessages, buildResponse, buildStructuredMessages, parseStructured } from './structured';

const NOT_IMPLEMENTED = 'not implemented in phase 1';

/** One entry in a fallback attempt log. */
type Attempt = { model: string; error: string };

/** Outcome of a single `openrouterComplete` call, wrapped with our timeout/cancel handling. */
type AttemptResult =
  | { outcome: 'ok'; response: AIResponse<string> }
  | { outcome: 'provider'; error: ProviderError }
  | { outcome: 'timeout' }
  | { outcome: 'cancelled'; cause: unknown }
  | { outcome: 'unexpected'; error: ProviderError };

/** True for a caller/timeout abort. DOMException isn't reliably `instanceof Error`, so match on `name`. */
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * Run one `openrouterComplete` call against `model` under a fresh per-attempt
 * timeout composed with the caller's signal. Never throws for a provider/timeout
 * failure — returns a discriminated `AttemptResult` the caller maps to control
 * flow. A caller cancellation is surfaced (not thrown) as `outcome: 'cancelled'`
 * carrying the original error, so the caller can re-throw it verbatim.
 */
async function attemptCompletion(
  config: ResolvedAIConfig,
  callerSignal: AbortSignal | undefined,
  model: string,
  messages: AIMessage[],
  temperature: number | undefined,
  maxTokens: number | undefined
): Promise<AttemptResult> {
  // Manual controller (not AbortSignal.timeout) so we hold the reference and can
  // later tell "our timeout fired" from "the caller cancelled".
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), config.attemptTimeoutMs);
  try {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;

    const opts: OpenRouterCallOptions = { model, messages, apiKey: config.openrouterApiKey, signal };
    if (temperature !== undefined) opts.temperature = temperature;
    if (maxTokens !== undefined) opts.maxTokens = maxTokens;
    if (config.referer !== undefined) opts.referer = config.referer;
    if (config.appTitle !== undefined) opts.appTitle = config.appTitle;

    return { outcome: 'ok', response: await openrouterComplete(opts) };
  } catch (err) {
    if (err instanceof ProviderError) return { outcome: 'provider', error: err };
    if (isAbortError(err)) {
      // If OUR timeout controller is the aborted one, we timed out; otherwise the
      // caller's signal fired.
      return timeoutController.signal.aborted ? { outcome: 'timeout' } : { outcome: 'cancelled', cause: err };
    }
    const wrapped = new ProviderError(
      'unknown',
      model,
      false,
      err instanceof Error ? err.message : String(err),
      { cause: err }
    );
    return { outcome: 'unexpected', error: wrapped };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Record a non-ok `AttemptResult` in the log and say whether to advance to the
 * next model or stop the walk. Re-throws the original error on caller cancel —
 * cancellation is intent, not a fallback trigger.
 */
function recordFailure(
  result: Exclude<AttemptResult, { outcome: 'ok' }>,
  model: string,
  timeoutMs: number,
  attempts: Attempt[]
): 'advance' | 'stop' {
  switch (result.outcome) {
    case 'provider':
      attempts.push({ model, error: result.error.message });
      return result.error.retryable ? 'advance' : 'stop';
    case 'timeout':
      attempts.push({ model, error: `Timed out after ${timeoutMs}ms` });
      return 'advance';
    case 'unexpected':
      attempts.push({ model, error: result.error.message });
      return 'stop';
    case 'cancelled':
      throw result.cause;
  }
}

/** Resolve the tier for a capability or throw a plain programming-error `Error`. */
function resolveTier(req: AIRequest): TierConfig {
  const tier: TierConfig | undefined = TIERS[req.capability];
  if (!tier) throw new Error(`Unknown AI capability: "${req.capability}"`);
  return tier;
}

/**
 * Generate a plain-text completion, walking the capability's model list with
 * fallback. Each model gets one attempt under a per-attempt timeout; retryable
 * failures (and timeouts) advance to the next model, a non-retryable failure
 * (e.g. auth) stops the walk, and a caller cancellation re-throws immediately.
 * If no model returns, throws `AllModelsExhaustedError` with the ordered attempt
 * log (most relevant failure last, `attempts.at(-1)`).
 */
export async function generate(req: AIRequest): Promise<AIResponse<string>> {
  const tier = resolveTier(req);
  const config = getAIConfig();
  const temperature = req.temperature ?? tier.defaultTemperature;
  const maxTokens = req.maxTokens ?? tier.defaultMaxTokens;

  const attempts: Attempt[] = [];
  for (const model of tier.models) {
    const result = await attemptCompletion(config, req.signal, model, req.messages, temperature, maxTokens);
    if (result.outcome === 'ok') return result.response;
    if (recordFailure(result, model, config.attemptTimeoutMs, attempts) === 'stop') break;
  }
  throw new AllModelsExhaustedError(req.capability, attempts);
}

/**
 * Generate a structured object validated against a Zod schema.
 *
 * Same tier-walking fallback as `generate()`, but each model gets up to two
 * tries: an initial attempt and, if the output can't be parsed/validated, one
 * repair attempt re-prompting the same model with the specific failure. A
 * provider/timeout failure on either try defers to the standard fallback
 * mapping (retryable → next model, non-retryable → stop). If both tries for a
 * model yield unparseable/invalid output, a `StructuredParseError` is logged for
 * that model (raw text from the *repair* attempt) and the walk advances. On
 * exhaustion, throws `AllModelsExhaustedError`; the last `StructuredParseError`
 * (when any) is attached as its `cause` for debugging.
 */
export async function generateObject<T>(
  req: AIRequest & { schema: z.ZodType<T>; schemaName?: string }
): Promise<AIResponse<T>> {
  const tier = resolveTier(req);
  const config = getAIConfig();
  const temperature = req.temperature ?? tier.defaultTemperature;
  const maxTokens = req.maxTokens ?? tier.defaultMaxTokens;

  const baseMessages = buildStructuredMessages(req.messages, req.schema, req.schemaName);
  const attempts: Attempt[] = [];
  let lastStructuredError: StructuredParseError | undefined;

  for (const model of tier.models) {
    // --- Initial attempt ---
    const first = await attemptCompletion(config, req.signal, model, baseMessages, temperature, maxTokens);
    if (first.outcome !== 'ok') {
      if (recordFailure(first, model, config.attemptTimeoutMs, attempts) === 'stop') break;
      continue;
    }
    const parsedFirst = parseStructured(first.response.content, req.schema);
    if (parsedFirst.ok) return buildResponse(first.response, parsedFirst.data);

    // --- Repair attempt (same model) ---
    const repairMessages = buildRepairMessages(
      baseMessages,
      first.response.content,
      parsedFirst.failure,
      parsedFirst.summary
    );
    const second = await attemptCompletion(config, req.signal, model, repairMessages, temperature, maxTokens);
    if (second.outcome !== 'ok') {
      if (recordFailure(second, model, config.attemptTimeoutMs, attempts) === 'stop') break;
      continue;
    }
    const parsedSecond = parseStructured(second.response.content, req.schema);
    if (parsedSecond.ok) return buildResponse(second.response, parsedSecond.data);

    // Both tries produced text that wouldn't parse/validate for this model.
    lastStructuredError = new StructuredParseError(second.response.content, req.schemaName, {
      cause: parsedSecond.cause,
    });
    attempts.push({ model, error: `Structured parse failed after repair: ${parsedSecond.summary}` });
  }

  throw new AllModelsExhaustedError(
    req.capability,
    attempts,
    lastStructuredError ? { cause: lastStructuredError } : undefined
  );
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
