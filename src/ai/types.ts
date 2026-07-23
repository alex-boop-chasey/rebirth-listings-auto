/**
 * Core types for the AI provider abstraction layer.
 *
 * This file defines the internal message format, request/response shapes,
 * streaming chunk shape, and the normalised error hierarchy that every AI
 * feature in the app speaks to. It contains no runtime logic beyond the error
 * classes — model selection, provider adapters, and fallback live elsewhere.
 *
 * Phase 1: shapes only. Nothing here performs I/O.
 */

/**
 * A capability tier names *what kind of work* a caller needs, not a model.
 * Tiers are mapped to concrete model lists centrally in `./tiers.ts`, so
 * features never hardcode model ids.
 *
 * - `chat-cheap`   — high-volume, buyer-facing chat. Free models only.
 * - `chat-quality` — reserved for future higher-reasoning chat.
 * - `writing`      — long-form generation (e.g. Sanity descriptions); quality > cost.
 * - `structured`   — anything that must return parseable JSON output.
 */
export type Capability = 'chat-cheap' | 'chat-quality' | 'writing' | 'structured';

/**
 * A single part of a multimodal message. `text` carries prose; `image_url`
 * carries an image reference in the OpenRouter/OpenAI-compatible shape. A message
 * whose `content` is a plain string is equivalent to a single text part — the
 * common case shared by every existing caller.
 */
export interface AITextPart {
  type: 'text';
  text: string;
}
export interface AIImagePart {
  type: 'image_url';
  image_url: { url: string };
}
export type AIContentPart = AITextPart | AIImagePart;

/** One turn in a conversation, in the layer's internal provider-agnostic format. */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  /**
   * Message body. A plain string is the common single-text case; an array of
   * parts enables multimodal input (text + images) for vision-capable models.
   * The OpenRouter adapter forwards this shape verbatim (`buildBody` sends
   * `messages` as-is), so an array flows straight through to the provider —
   * no adapter or fallback-loop change is needed to carry images.
   */
  content: string | AIContentPart[];
}

/** A request into the layer. The `capability` selects the tier (and thus the model list). */
export interface AIRequest {
  capability: Capability;
  messages: AIMessage[];
  /** Overrides the tier's `defaultTemperature` when set. */
  temperature?: number;
  /** Overrides the tier's `defaultMaxTokens` when set. */
  maxTokens?: number;
  /** Caller-supplied abort signal; aborting cancels the in-flight provider call. */
  signal?: AbortSignal;
  /**
   * Provider-specific options passed through the layer to the underlying
   * adapter. This is an escape hatch for model/provider-specific config that
   * doesn't belong in the abstraction (e.g. OpenRouter's `reasoning` field). The
   * adapter decides which keys it understands; unknown keys are forwarded to the
   * provider (OpenRouter ignores unknown params, per its docs).
   */
  providerOptions?: Record<string, unknown>;
}

/** Why a generation stopped. `error` is used when the layer surfaces a failed completion as data. */
export type FinishReason = 'stop' | 'length' | 'error';

/** Token accounting for a single completed request, when the provider reports it. */
export interface TokenUsage {
  input: number;
  output: number;
}

/**
 * A completed (non-streaming) response.
 *
 * Generic over the content type so `generate` returns `AIResponse<string>` and
 * `generateObject` returns `AIResponse<T>` for the parsed object.
 */
export interface AIResponse<T = string> {
  content: T;
  /** The concrete OpenRouter model id that actually served the request — not the tier. */
  modelUsed: string;
  tokensUsed?: TokenUsage;
  finishReason: FinishReason;
}

/**
 * One chunk of a streamed response. Modelled as a discriminated union on `done`
 * so TypeScript enforces that terminal metadata (`modelUsed`, `tokensUsed`) is
 * only present — and is required — on the final chunk.
 */
export type AIStreamChunk =
  | { delta: string; done: false }
  | { delta: string; done: true; modelUsed: string; tokensUsed?: TokenUsage };

/**
 * Base class for every error the layer throws. Catchers can `instanceof AIError`
 * to distinguish layer-originated failures from unexpected runtime errors.
 */
export class AIError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AIError';
  }
}

/**
 * Thrown when every model in a tier's list has been tried and all failed. Carries
 * the capability and a per-model record of what went wrong, in attempt order.
 */
export class AllModelsExhaustedError extends AIError {
  readonly capability: Capability;
  readonly attempts: Array<{ model: string; error: string }>;

  constructor(
    capability: Capability,
    attempts: Array<{ model: string; error: string }>,
    options?: { cause?: unknown }
  ) {
    super(`All models exhausted for capability "${capability}" (${attempts.length} attempted)`, options);
    this.name = 'AllModelsExhaustedError';
    this.capability = capability;
    this.attempts = attempts;
  }
}

/**
 * Thrown when a stream fails *after* at least one token has already been emitted.
 * Because tokens have reached the caller, the layer cannot silently restart on a
 * fallback model — it surfaces the partial content instead. (A failure *before*
 * the first token restarts on the next model without throwing this.)
 */
export class StreamInterruptedError extends AIError {
  readonly partialContent: string;
  readonly modelUsed: string;

  constructor(partialContent: string, modelUsed: string, options?: { cause?: unknown }) {
    super(`Stream interrupted after emitting ${partialContent.length} char(s) from "${modelUsed}"`, options);
    this.name = 'StreamInterruptedError';
    this.partialContent = partialContent;
    this.modelUsed = modelUsed;
  }
}

/**
 * Thrown when structured output cannot be parsed/validated even after the single
 * repair attempt the layer allows. Carries the raw model text and the schema name
 * (when the caller supplied one) for diagnostics.
 */
export class StructuredParseError extends AIError {
  readonly rawContent: string;
  readonly schemaName?: string;

  constructor(rawContent: string, schemaName?: string, options?: { cause?: unknown }) {
    super(
      schemaName
        ? `Failed to parse structured output for schema "${schemaName}" after one repair attempt`
        : 'Failed to parse structured output after one repair attempt',
      options
    );
    this.name = 'StructuredParseError';
    this.rawContent = rawContent;
    this.schemaName = schemaName;
  }
}

/** The kind of provider-side failure a `ProviderError` normalises. */
export type ProviderErrorKind =
  | 'rate-limit'
  | 'auth'
  | 'model-unavailable'
  | 'network'
  | 'malformed'
  /** Well-formed response that carried no text — retryable (another model may reply). */
  | 'empty-response'
  | 'unknown';

/**
 * A single provider-side failure, normalised across adapters. `retryable` tells
 * the fallback logic whether trying the next model could plausibly help.
 */
export class ProviderError extends AIError {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly model: string;

  constructor(
    kind: ProviderErrorKind,
    model: string,
    retryable: boolean,
    message?: string,
    options?: { cause?: unknown }
  ) {
    super(message ?? `Provider error (${kind}) from model "${model}"`, options);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryable = retryable;
    this.model = model;
  }
}
