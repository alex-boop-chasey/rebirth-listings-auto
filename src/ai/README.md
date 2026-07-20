# `src/ai/` — AI provider abstraction layer

One internal seam that every AI feature in the app calls, so nothing talks to
OpenRouter (or any provider) inline. It centralises model selection, structured
output, streaming, and fallback behind a small, stable API. Callers ask for a
**capability**, not a model; the layer maps capabilities → model lists centrally.

> **Phase 1 status:** this is a scaffold — types, tiers, and signatures only.
> The three functions throw `not implemented in phase 1`. Provider adapters
> (`src/ai/providers/`) and real logic land in later phases.

## Capability tiers

Pick the tier by the *kind of work*, not by a model name (see `tiers.ts`):

| Capability     | Use for                                              | Notes                          |
| -------------- | ---------------------------------------------------- | ------------------------------ |
| `chat-cheap`   | High-volume, buyer-facing chat                       | **Free models only**           |
| `chat-quality` | Future higher-reasoning chat                         | Reserved (placeholder model)   |
| `writing`      | Long-form generation (e.g. Sanity descriptions)      | Quality > cost                 |
| `structured`   | Anything that must return parseable JSON             | Use with `generateObject`      |

## Public functions

Import from the barrel (`~/ai`):

- `generate(req)` → `AIResponse<string>` — plain-text completion.
- `generateObject(req & { schema, schemaName? })` → `AIResponse<T>` — JSON output
  validated against a Zod schema.
- `generateStream(req)` → `AsyncIterable<AIStreamChunk>` — token-by-token stream;
  the final chunk (`done: true`) carries `modelUsed` and, when reported, `tokensUsed`.

Every `AIResponse.modelUsed` is the concrete model id that served the request —
not the tier.

## Fallback rules

- **Model list, in order.** Each tier lists a primary followed by fallbacks. The
  layer tries them in order until one succeeds.
- **Exhaustion throws.** If every model in the tier fails, the layer throws
  `AllModelsExhaustedError` with a per-model attempt log.
- **`chat-cheap` stays free.** Its list contains only free models; fallback never
  escalates to a paid model.
- **Streaming restarts pre-first-token only.** If a model fails before emitting
  any token, the stream silently restarts on the next model. If it fails *after*
  a token has been emitted, the layer throws `StreamInterruptedError` (with the
  partial content) rather than replaying text on another model.
- **Structured output gets one repair.** `generateObject` re-prompts a model once
  on a parse/validation failure before moving on; if it still can't validate,
  throws `StructuredParseError`.

## Boundary

**Do not import from `src/ai/providers/` outside this folder.** That directory is
the layer's internal implementation. Everything external goes through `~/ai`.
