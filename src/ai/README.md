# `src/ai/` — AI provider abstraction layer

One internal seam that every AI feature in the app calls. It centralises model
selection, structured (JSON) output, streaming, and provider fallback behind
three functions, so no feature talks to OpenRouter — or any provider — inline.
You ask for a *capability*, not a model; the layer maps that capability to an
ordered list of models and walks it on failure. Building a new AI feature
(listing descriptions, per-listing chat) means calling one of the three
functions below — never writing another `fetch`.

## The three public functions

Import them from the barrel: `import { generate, generateStream } from '~/ai'`.

**`generate(req: AIRequest): Promise<AIResponse<string>>`** — a plain-text
completion. Walks the capability's model list in order; a *retryable* failure
(rate-limit, timeout, empty response) advances to the next model, a
*non-retryable* one (e.g. auth) stops the walk. If every model fails it throws
`AllModelsExhaustedError` carrying a per-model attempt log.

**`generateObject<T>(req & { schema: z.ZodType<T>; schemaName?: string }):
Promise<AIResponse<T>>`** — the same walk, but each model gets one *repair*
attempt: if its output can't be parsed or fails schema validation, the layer
re-prompts that model once with the specific error before moving on.
`content` is the parsed, validated object.

**`generateStream(req: AIRequest): AsyncIterable<AIStreamChunk>`** —
token-by-token streaming. Yields `{ delta, done: false }` chunks, then one
terminal `{ delta: '', done: true, modelUsed, tokensUsed? }`. Its fallback is
stricter than the others': it may restart on the next model only **before the
first token reaches you**; once any token has been yielded it cannot rewind, so
a later failure throws `StreamInterruptedError` with the partial content rather
than silently switching models mid-stream.

The fallback rules, stated plainly: **`chat-cheap` uses free-tier models only**;
the layer **throws on exhaustion** (it never returns a degraded or empty
"success"); **streams restart pre-first-token only**; **structured output gets
exactly one repair attempt per model**.

## Capability tiers

Callers pick a capability (`types.ts`), which resolves to an ordered model list
in `tiers.ts`:

- **`chat-cheap`** — high-volume, buyer-facing chat (the site chatbot). Free
  models only: `gpt-oss-20b` → `gemma-4-26b`.
- **`chat-quality`** — reserved for future higher-reasoning chat.
- **`writing`** — long-form generation (e.g. Sanity listing descriptions);
  quality over cost.
- **`structured`** — anything that must return validated JSON; pair with
  `generateObject`.

Adding a capability is a two-step, compile-checked change: add it to the
`Capability` union in `types.ts` **and** add a matching entry to `TIERS` in
`tiers.ts`. `TIERS` is typed `as const satisfies Record<Capability, TierConfig>`,
so the type checker fails the build if the two ever fall out of sync.

## Config seam

The layer never reads env itself — there's no `process.env` at module load on
Cloudflare Workers, and reaching for `import.meta.env` would couple the layer to
Astro/Vite. Instead the request entry point configures it once:

```ts
configureAI({ openrouterApiKey, referer, appTitle });
```

Call it at the **top of the request handler, once per request** — see the real
call site in `src/pages/api/chat.ts`. The idempotency guard makes repeat calls
with identical config a no-op; it *throws* only when called again with
*different* values in the same isolate, to surface accidental re-configuration
rather than silently switching keys. `getAIConfig()` reads it back (with
defaults applied); `resetAIConfig()` clears it (for tests).

## `providerOptions` — the escape hatch

`AIRequest.providerOptions?: Record<string, unknown>` forwards provider-specific
request fields the abstraction deliberately doesn't model — today, OpenRouter's
`reasoning: { effort }`. The OpenRouter adapter merges only **whitelisted** keys
(`PROVIDER_OPTION_WHITELIST`) into the request body, so a passthrough can never
silently overwrite `model` / `messages` / `stream` / `temperature` /
`max_tokens`. This is an *escape hatch* by design: a caller reaching for it is
consciously stepping outside the abstraction for provider-specific behaviour,
and that's fine — but it's the exception, not the pattern.

## Errors

All extend `AIError`:

- **`ProviderError`** — one normalised provider-side failure (`kind`,
  `retryable`, `model`). Usually consumed internally by the fallback walk; you
  see it only if you call an adapter directly.
- **`AllModelsExhaustedError`** — every model in the tier failed; carries the
  ordered `attempts` log (`attempts.at(-1)` is the most relevant failure).
- **`StreamInterruptedError`** — a stream failed *after* emitting tokens;
  carries `partialContent` and `modelUsed`.
- **`StructuredParseError`** — `generateObject` output couldn't be
  parsed/validated even after the repair attempt; carries the raw text.

## Migration example

Every feature moves from an inline provider `fetch` to a layer call. The
chatbot's streaming path, before:

```ts
const upstream = await fetch(OPENROUTER_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': APP_URL /* … */ },
  body: JSON.stringify({ model: MODEL, messages, stream: true, reasoning: { effort } }),
});
const reader = upstream.body.getReader();
// …hand-rolled SSE parsing: split on \n, strip "data:", detect [DONE]…
```

after:

```ts
for await (const chunk of generateStream({
  capability: 'chat-cheap',
  messages,
  temperature: 0.5,
  maxTokens: 700,
  providerOptions: { reasoning: { effort: 'low' } },
})) {
  if (chunk.done) { modelUsed = chunk.modelUsed; continue; }
  // chunk.delta is a content token — the feature keeps only its own logic
}
```

The wire format, headers, `[DONE]` handling, and model fallback all move behind
the layer; the feature keeps only what's genuinely its own (here, the chatbot's
escalation-marker buffering).

## The rule

**Do not import from `src/ai/providers/` outside this folder.** Go through the
public surface (`~/ai`) so you can't bypass tier fallback or the config seam.
This repo has no ESLint, so the invariant is enforced by a grep check:

```
npm run check:ai-imports
```

It exits non-zero (and prints the offender) if any file outside `src/ai/`
imports from `src/ai/providers/*`. Run it in CI or before pushing.
