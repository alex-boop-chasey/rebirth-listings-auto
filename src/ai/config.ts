/**
 * Runtime configuration seam for the AI layer.
 *
 * The client can't read env itself: on Cloudflare Workers there is no
 * `process.env` at module load, and reaching for `import.meta.env` would couple
 * this layer to Astro/Vite. So a caller (Phase 6: the chat API route, sourcing
 * the key from `src/chatbot/get-env.ts`) calls `configureAI(...)` once per Worker
 * invocation, and the client reads it back via `getAIConfig()`.
 *
 * State lives in a module-level `let` — per-isolate state on Workers. That is
 * safe here: each Worker invocation runs against the same env bindings, and
 * isolates never share state across accounts. The double-configure guard catches
 * the real bug this could hide — two code paths configuring different keys.
 */

export interface AIConfig {
  openrouterApiKey: string;
  /** Optional HTTP-Referer header for OpenRouter attribution. */
  referer?: string;
  /** Optional X-Title header for OpenRouter attribution. */
  appTitle?: string;
  /** Per-attempt timeout in ms before we give up on a model and try the next. Default 30_000. */
  attemptTimeoutMs?: number;
  /**
   * Per-attempt timeout in ms for streaming calls. Streaming users are
   * latency-sensitive, so this defaults to a shorter window than
   * `attemptTimeoutMs`. It is a time-to-first-token budget only. Default 10_000.
   */
  streamAttemptTimeoutMs?: number;
}

/** Config with the fields the client always needs resolved to concrete values. */
export type ResolvedAIConfig = Required<
  Pick<AIConfig, 'openrouterApiKey' | 'attemptTimeoutMs' | 'streamAttemptTimeoutMs'>
> &
  AIConfig;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_ATTEMPT_TIMEOUT_MS = 10_000;

let current: AIConfig | null = null;

/**
 * Set the AI layer config for this isolate. Idempotent when re-called with an
 * identical config; throws if re-called with a *different* one (shallow
 * JSON-equality) to surface accidental re-configuration rather than silently
 * switching keys mid-flight.
 */
export function configureAI(config: AIConfig): void {
  if (current !== null) {
    if (JSON.stringify(current) === JSON.stringify(config)) return;
    throw new Error('configureAI() called again with different values; call resetAIConfig() first.');
  }
  current = { ...config };
}

/** Read the current config, with defaults applied. Throws if not yet configured. */
export function getAIConfig(): ResolvedAIConfig {
  if (current === null) {
    throw new Error('AI layer is not configured — call configureAI() before generate().');
  }
  return {
    ...current,
    openrouterApiKey: current.openrouterApiKey,
    attemptTimeoutMs: current.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    streamAttemptTimeoutMs: current.streamAttemptTimeoutMs ?? DEFAULT_STREAM_ATTEMPT_TIMEOUT_MS,
  };
}

/** Clear the config. For tests, or between Worker requests if ever needed. */
export function resetAIConfig(): void {
  current = null;
}
