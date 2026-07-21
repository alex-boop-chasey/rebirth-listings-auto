/**
 * Public entry points for the AI provider abstraction layer.
 *
 * Every AI feature calls one of these three functions; nothing in the app should
 * talk to OpenRouter (or any provider) directly once this layer is in use. All
 * three resolve the request's `capability` to a model list via `./tiers.ts` and
 * apply the layer's fallback semantics documented per-function below.
 *
 * `generate()`, `generateObject()`, and `generateStream()` are implemented
 * (Phases 3–5).
 */

import { z } from 'zod';
import type { AIMessage, AIRequest, AIResponse, AIStreamChunk } from './types';
import {
  AllModelsExhaustedError,
  ProviderError,
  StreamInterruptedError,
  StructuredParseError,
} from './types';
import { TIERS, type TierConfig } from './tiers';
import { getAIConfig, type ResolvedAIConfig } from './config';
import {
  openrouterComplete,
  openrouterStream,
  type OpenRouterCallOptions,
} from './providers/openrouter';
import { buildRepairMessages, buildResponse, buildStructuredMessages, parseStructured } from './structured';

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
  maxTokens: number | undefined,
  providerOptions: Record<string, unknown> | undefined
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
    if (providerOptions !== undefined) opts.providerOptions = providerOptions;

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
    const result = await attemptCompletion(config, req.signal, model, req.messages, temperature, maxTokens, req.providerOptions);
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
    const first = await attemptCompletion(config, req.signal, model, baseMessages, temperature, maxTokens, req.providerOptions);
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
    const second = await attemptCompletion(config, req.signal, model, repairMessages, temperature, maxTokens, req.providerOptions);
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
 * Stream a plain-text completion chunk-by-chunk, walking the capability's model
 * list under the **pre-first-token restart rule**:
 *
 * - Fail BEFORE any content delta reaches the consumer → transparently restart
 *   on the next model (the consumer only sees a longer time-to-first-token).
 * - Fail AFTER ≥1 delta has been yielded → abort with `StreamInterruptedError`
 *   carrying the partial content and the streaming model. Never mid-stream
 *   restart on a fresh model.
 *
 * Why not mid-stream restart: model B has no idea what model A already said, so
 * resuming on it produces visible repetition, contradiction, or topic drift.
 * Pre-first-token restart is invisible; the rule gives us that without pretending
 * the hard case is solvable.
 *
 * The per-attempt `streamAttemptTimeoutMs` is a time-to-FIRST-token budget only —
 * it is cleared the moment the first delta arrives, so a healthy long response is
 * never cut off mid-stream. The provider's terminal chunk (`done: true`) is
 * passed through verbatim; its `modelUsed` is authoritative (OpenRouter may
 * reroute), so we never synthesise our own.
 */
export function generateStream(req: AIRequest): AsyncIterable<AIStreamChunk> {
  return streamGenerator(req);
}

async function* streamGenerator(req: AIRequest): AsyncGenerator<AIStreamChunk> {
  const tier = resolveTier(req);
  const config = getAIConfig();
  const temperature = req.temperature ?? tier.defaultTemperature;
  const maxTokens = req.maxTokens ?? tier.defaultMaxTokens;

  const attempts: Attempt[] = [];
  let hasEmitted = false; // latches true on the first delta and STAYS true across models
  let partialContent = ''; // content yielded so far (only ever from the emitting model)

  for (const model of tier.models) {
    // Manual controller (not AbortSignal.timeout) so we hold the reference and
    // can tell "our timeout fired" from "the caller cancelled".
    const timeoutController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => timeoutController.abort(),
      config.streamAttemptTimeoutMs
    );
    // Idempotent: clears the TTFT timeout once, on first token or in `finally`.
    const clearAttemptTimeout = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    try {
      const signal = req.signal
        ? AbortSignal.any([req.signal, timeoutController.signal])
        : timeoutController.signal;

      const opts: OpenRouterCallOptions = { model, messages: req.messages, apiKey: config.openrouterApiKey, signal };
      if (temperature !== undefined) opts.temperature = temperature;
      if (maxTokens !== undefined) opts.maxTokens = maxTokens;
      if (config.referer !== undefined) opts.referer = config.referer;
      if (config.appTitle !== undefined) opts.appTitle = config.appTitle;
      if (req.providerOptions !== undefined) opts.providerOptions = req.providerOptions;

      for await (const chunk of openrouterStream(opts)) {
        if (chunk.done) {
          yield chunk; // terminal chunk — authoritative, passed through verbatim
          return;
        }
        // Content delta: the first token of this attempt cancels the TTFT budget.
        clearAttemptTimeout();
        hasEmitted = true;
        partialContent += chunk.delta;
        yield chunk;
      }

      // Provider generators always yield a terminal chunk or throw; a clean end
      // without one is anomalous. Defensive:
      if (hasEmitted) {
        throw new StreamInterruptedError(partialContent, model, {
          cause: new Error('Provider stream ended without a terminal chunk'),
        });
      }
      attempts.push({ model, error: 'Stream ended without a terminal chunk' });
    } catch (err) {
      // A StreamInterruptedError raised in the try body (defensive paths) is
      // already the right shape — don't re-wrap it.
      if (err instanceof StreamInterruptedError) throw err;

      if (err instanceof ProviderError) {
        if (hasEmitted) {
          // Post-first-token: committed to this model, cannot restart.
          throw new StreamInterruptedError(partialContent, model, { cause: err });
        }
        // Pre-first-token: record, then restart (retryable) or stop (not).
        attempts.push({ model, error: err.message });
        if (!err.retryable) break;
        continue;
      }

      if (isAbortError(err)) {
        if (!timeoutController.signal.aborted) {
          throw err; // caller cancelled — intent, regardless of hasEmitted
        }
        // Our TTFT timeout fired.
        if (hasEmitted) {
          // Unreachable once the timeout is cleared on first token; treat
          // defensively as a post-first-token failure.
          throw new StreamInterruptedError(partialContent, model, { cause: err }); // defensive
        }
        attempts.push({ model, error: `Timed out before first token after ${config.streamAttemptTimeoutMs}ms` });
        continue;
      }

      // Unexpected non-provider error.
      if (hasEmitted) {
        throw new StreamInterruptedError(partialContent, model, { cause: err });
      }
      const wrapped = new ProviderError(
        'unknown',
        model,
        false,
        err instanceof Error ? err.message : String(err),
        { cause: err }
      );
      attempts.push({ model, error: wrapped.message });
      break;
    } finally {
      // Runs on success return, thrown errors, AND consumer `.return()` (early
      // break out of a `for await`) — so the timer never leaks.
      clearAttemptTimeout();
    }
  }

  // Walk ended without a successful terminal chunk. We can only reach here with
  // hasEmitted === false — any post-emit failure above threw directly.
  throw new AllModelsExhaustedError(req.capability, attempts);
}
