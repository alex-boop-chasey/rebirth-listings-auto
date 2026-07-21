/**
 * OpenRouter provider adapter — the ONLY file that knows OpenRouter's
 * (OpenAI-compatible) wire format.
 *
 * `openrouterComplete` (JSON) and `openrouterStream` (SSE) each take an explicit
 * `apiKey` (no env reads here — keeps the adapter runtime-agnostic/testable) and
 * normalise *every* provider-side failure into a `ProviderError`. The client
 * layer (Phase 3+) owns tier fallback, so this file classifies faults but never
 * retries or picks models. Low-level SSE/JSON parsing lives in
 * `./openrouter-sse.ts`; this file owns the HTTP calls, error taxonomy, and
 * response mapping. Workers-only: `fetch`, `TextDecoder`, native streams.
 */

import type {
  AIMessage,
  AIResponse,
  AIStreamChunk,
  ProviderErrorKind,
  TokenUsage,
} from '../types';
import { ProviderError } from '../types';
import {
  extractBodyError,
  extractEventData,
  extractUsage,
  isRecord,
  mapFinishReason,
  parseSseData,
  type BodyError,
} from './openrouter-sse';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterCallOptions {
  /** Exact OpenRouter model id, e.g. "openai/gpt-oss-20b:free". */
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Passed explicitly — the adapter never reads env itself. */
  apiKey: string;
  /** Optional HTTP-Referer header (OpenRouter attribution). */
  referer?: string;
  /** Optional X-Title header (OpenRouter attribution). */
  appTitle?: string;
  /** Provider-specific passthrough (see PROVIDER_OPTION_WHITELIST). */
  providerOptions?: Record<string, unknown>;
}

/**
 * The only `providerOptions` keys merged into the request body. It's a
 * whitelist, not a blocklist, because a passthrough that could overwrite
 * `model`/`messages`/`stream`/`temperature`/`max_tokens` would be a silent,
 * horrible bug — better to forward only keys we've vetted. Add keys here as new
 * provider-specific features are needed.
 */
// verified: `reasoning` passthrough is safe on google/gemma-4-26b-a4b-it:free as of 2026-07-21
const PROVIDER_OPTION_WHITELIST = ['reasoning'] as const;

// ---------------------------------------------------------------------------
// Request construction / shared helpers
// ---------------------------------------------------------------------------

/**
 * True for a caller-initiated abort. Abort is caller *intent*, not a provider
 * failure, so these are re-thrown verbatim rather than wrapped in ProviderError.
 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Construct and throw a normalised ProviderError. Returns `never`. */
function fail(
  kind: ProviderErrorKind,
  model: string,
  retryable: boolean,
  message: string,
  cause: unknown
): never {
  throw new ProviderError(kind, model, retryable, message, { cause });
}

function buildHeaders(opts: OpenRouterCallOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (opts.referer) headers['HTTP-Referer'] = opts.referer;
  if (opts.appTitle) headers['X-Title'] = opts.appTitle;
  return headers;
}

function buildBody(opts: OpenRouterCallOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: opts.model, messages: opts.messages, stream };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  // Merge only whitelisted provider-specific keys, AFTER the standard fields so
  // the whitelist itself is the only thing guarding them (see the const above).
  if (opts.providerOptions) {
    for (const key of PROVIDER_OPTION_WHITELIST) {
      if (opts.providerOptions[key] !== undefined) body[key] = opts.providerOptions[key];
    }
  }
  return body;
}

function networkMessage(err: unknown): string {
  return `Network error calling OpenRouter: ${err instanceof Error ? err.message : String(err)}`;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

interface Classification {
  kind: ProviderErrorKind;
  retryable: boolean;
}

/**
 * Classify HTTP transport-level status codes. The 400-with-"model"-hint case
 * lets a bad/withdrawn model id fall through to the next model in the tier
 * rather than aborting the whole request.
 */
function classifyHttpStatus(status: number, bodyText: string): Classification {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate-limit', retryable: true };
  if (status === 404) return { kind: 'model-unavailable', retryable: true };
  if (status === 400 && /model/i.test(bodyText)) return { kind: 'model-unavailable', retryable: true };
  if (status === 502 || status === 503 || status === 504) return { kind: 'network', retryable: true };
  if (status >= 400 && status < 500) return { kind: 'unknown', retryable: false };
  return { kind: 'unknown', retryable: true }; // 5xx and anything else server-side
}

/**
 * Classify an error surfaced *inside* a response body — a 200-OK JSON with an
 * `{ error }` field (upstream free-tier host rate-limited/failed while
 * OpenRouter's own HTTP layer succeeded) or a mid-stream SSE `error` event.
 * All are retryable so the client can try the next model. Matching is lenient
 * and case-insensitive:
 *  - code 429 OR message has "rate limit"/"rate-limit"   → rate-limit
 *  - message has "unavailable"/"overloaded"/"provider"   → model-unavailable
 *  - otherwise                                           → unknown
 */
function classifyBodyError(e: BodyError): Classification {
  const msg = (e.message ?? '').toLowerCase();
  const codeNum = typeof e.code === 'number' ? e.code : Number(e.code);
  if (codeNum === 429 || msg.includes('rate limit') || msg.includes('rate-limit')) {
    return { kind: 'rate-limit', retryable: true };
  }
  if (msg.includes('unavailable') || msg.includes('overloaded') || msg.includes('provider')) {
    return { kind: 'model-unavailable', retryable: true };
  }
  return { kind: 'unknown', retryable: true };
}

/** Shared HTTP call: performs the fetch, normalising abort + transport faults. */
async function callOpenRouter(opts: OpenRouterCallOptions, stream: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: buildHeaders(opts),
      body: JSON.stringify(buildBody(opts, stream)),
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    return fail('network', opts.model, true, networkMessage(err), err);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const c = classifyHttpStatus(res.status, bodyText);
    return fail(c.kind, opts.model, c.retryable, `OpenRouter HTTP ${res.status}: ${bodyText.slice(0, 300)}`, bodyText);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Non-streaming call
// ---------------------------------------------------------------------------

/**
 * Non-streaming completion. Resolves with a normalised `AIResponse<string>` or
 * throws `ProviderError` (never any other error type — save an `AbortError`,
 * which is re-thrown as-is for caller cancellation).
 */
export async function openrouterComplete(opts: OpenRouterCallOptions): Promise<AIResponse<string>> {
  const res = await callOpenRouter(opts, false);

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    if (isAbortError(err)) throw err;
    return fail('malformed', opts.model, false, 'OpenRouter response was not valid JSON', err);
  }

  // 200 OK but with an `error` field in the body.
  const bodyErr = extractBodyError(parsed);
  if (bodyErr) {
    const c = classifyBodyError(bodyErr);
    return fail(c.kind, opts.model, c.retryable, `OpenRouter error body: ${bodyErr.message ?? 'unknown error'}`, parsed);
  }

  if (!isRecord(parsed)) {
    return fail('malformed', opts.model, false, 'OpenRouter response was not an object', parsed);
  }

  const choices = parsed.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  if (!isRecord(message)) {
    // No choices, or no message object: the response is structurally broken.
    // Retrying the same call won't help → non-retryable.
    return fail('malformed', opts.model, false, 'OpenRouter response had no message', parsed);
  }
  const content = typeof message.content === 'string' ? message.content : '';
  if (content.trim() === '') {
    // A well-formed response that simply carried no text (e.g. a reasoning model
    // that spent its whole token budget "thinking"). Another model may reply, so
    // this is retryable — the client falls through to the next model in the tier.
    return fail('empty-response', opts.model, true, 'OpenRouter response had empty content', parsed);
  }

  const modelUsed = typeof parsed.model === 'string' && parsed.model ? parsed.model : opts.model;
  const finishReason = mapFinishReason(isRecord(first) ? first.finish_reason : undefined);
  const tokensUsed = extractUsage(parsed.usage);

  const response: AIResponse<string> = { content, modelUsed, finishReason };
  if (tokensUsed) response.tokensUsed = tokensUsed;
  return response;
}

// ---------------------------------------------------------------------------
// Streaming call
// ---------------------------------------------------------------------------

/**
 * Streaming completion. Yields content deltas as `{ delta, done: false }`, then
 * one terminal `{ delta: '', done: true, modelUsed, tokensUsed? }` chunk after
 * `[DONE]` (or a clean stream end that carried a `finish_reason`).
 *
 * Errors are normalised to `ProviderError` thrown *from the iterator*: a
 * transport/HTTP failure before the stream opens (same taxonomy as complete), a
 * mid-stream SSE `error` event (classified like a 200-body error), or a stream
 * that ends without completing (`kind: "network"`). An `AbortError` is re-thrown
 * as-is. The client layer decides whether a thrown error becomes a
 * `StreamInterruptedError` based on whether it had already yielded tokens.
 *
 * `finish_reason` is captured internally for completion detection but is NOT put
 * on the emitted chunk — `AIStreamChunk`'s terminal variant in types.ts has no
 * such field, and this phase must not modify types.ts.
 */
export function openrouterStream(opts: OpenRouterCallOptions): AsyncIterable<AIStreamChunk> {
  return streamChunks(opts);
}

async function* streamChunks(opts: OpenRouterCallOptions): AsyncGenerator<AIStreamChunk> {
  const res = await callOpenRouter(opts, true);
  if (!res.body) {
    return fail('network', opts.model, true, 'OpenRouter streaming response had no body', null);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let modelUsed = opts.model;
  let tokensUsed: TokenUsage | undefined;
  let sawTerminal = false; // saw [DONE] or a finish_reason
  let emittedContent = false; // adapter-local: did any content delta reach the consumer?

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush the decoder and force any trailing (un-terminated) event block
        // through the same drain loop, so a final finish_reason/usage/[DONE]
        // isn't missed.
        buffer += decoder.decode();
        if (buffer && !buffer.endsWith('\n\n')) buffer += '\n\n';
      } else {
        buffer += decoder.decode(value, { stream: true });
      }

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const outcome = handleEventBlock(block, opts.model);
        if (!outcome) continue;
        if (outcome.model) modelUsed = outcome.model;
        if (outcome.usage) tokensUsed = outcome.usage;
        if (outcome.terminal) sawTerminal = true;
        if (outcome.delta) {
          emittedContent = true;
          yield { delta: outcome.delta, done: false };
        }
        if (outcome.isDone) {
          // Clean [DONE] with no content at all → retryable empty-response, so the
          // client falls through to the next model (parity with the old "empty
          // completion → try fallback" behaviour).
          if (!emittedContent) {
            fail('empty-response', opts.model, true, 'OpenRouter stream completed with no content', null);
          }
          yield terminalChunk(modelUsed, tokensUsed);
          return;
        }
      }

      if (done) break;
    }
  } catch (err) {
    if (isAbortError(err) || err instanceof ProviderError) throw err;
    return fail('network', opts.model, true, `OpenRouter stream read failed: ${
      err instanceof Error ? err.message : String(err)
    }`, err);
  }

  // Reached the end of the body. A finish_reason (without a trailing [DONE])
  // still counts as a clean completion; anything else is a dropped connection.
  if (sawTerminal) {
    // finish_reason but zero content → same retryable empty-response as [DONE].
    if (!emittedContent) {
      return fail('empty-response', opts.model, true, 'OpenRouter stream completed with no content', null);
    }
    yield terminalChunk(modelUsed, tokensUsed);
    return;
  }
  return fail('network', opts.model, true, 'OpenRouter stream ended before completion', null);
}

/** What one parsed SSE event block asks the stream loop to do. */
interface BlockOutcome {
  delta?: string;
  model?: string;
  usage?: TokenUsage;
  terminal: boolean; // saw a finish_reason or [DONE]
  isDone: boolean; // saw the [DONE] sentinel specifically
}

/**
 * Frame one SSE event block into a `BlockOutcome`, or `null` if it carried no
 * usable data. Throws `ProviderError` on a mid-stream SSE `error` event.
 */
function handleEventBlock(block: string, model: string): BlockOutcome | null {
  const payload = extractEventData(block);
  if (payload === null) return null;
  const parsed = parseSseData(payload);
  if (parsed === null) return null;

  if (parsed.error) {
    const c = classifyBodyError(parsed.error);
    return fail(c.kind, model, c.retryable, `OpenRouter stream error: ${parsed.error.message ?? 'unknown error'}`, parsed.error);
  }

  const outcome: BlockOutcome = {
    terminal: parsed.isDone || parsed.finishReason !== undefined,
    isDone: parsed.isDone,
  };
  if (parsed.contentDelta) outcome.delta = parsed.contentDelta;
  if (parsed.model) outcome.model = parsed.model;
  if (parsed.usage) outcome.usage = parsed.usage;
  return outcome;
}

/** Build the single terminal chunk, omitting `tokensUsed` when unknown. */
function terminalChunk(modelUsed: string, tokensUsed: TokenUsage | undefined): AIStreamChunk {
  return tokensUsed
    ? { delta: '', done: true, modelUsed, tokensUsed }
    : { delta: '', done: true, modelUsed };
}
