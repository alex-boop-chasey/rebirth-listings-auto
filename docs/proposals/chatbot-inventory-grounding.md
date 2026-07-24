# Build ticket — Rebi inventory + business-facts grounding ("Overview + Live Lookup")

**Status:** approved by owner (direction + dealerNotes-excluded). Chosen via a 3-agent design contest
(see the "Solution contest" format in DECISIONS.md). This doc is the winning synthesis and the build
spec. Provenance: Agent 1 proposed a KV-cached whole-lot digest; Agent 2 proposed per-turn live
retrieval with LLM extraction; Agent 3 (critic) verified both against the code. This design takes the
robust half of each and removes both their failure modes.

## Goal
Give Rebi (the site chatbot) two grounding sources so it answers accurately about:
1. the **live vehicle inventory** in Sanity (shifting stock), and
2. a **maintainable business-facts document** (services, location, phone, years in business, brands
   stocked, hours, etc.), dealer-editable in Studio — replacing today's placeholder `knowledge.ts`.

## Non-negotiable constraints
- **Additive only.** Preserve ALL existing chatbot behaviour: streaming with `[[ESCALATE]]`/`[[RESOLVED]]`
  first-line marker suppression, Turnstile, D1 memory, Telegram human-handoff. If grounding fails,
  degrade to today's behaviour (fail-open) — never a 500, never a broken stream.
- **No new AI/LLM call in the grounding path.** Intent extraction is **deterministic** (keyword/enum
  match), not an LLM round-trip. This is the deliberate fix for the contest's Agent-2 weakness
  (doubled latency, fallback-less free-model dependency, silent parse failure). All existing AI still
  routes through `src/ai/` unchanged.
- **`dealerNotes` is EXCLUDED from chat grounding entirely (owner decision).** Use only public listing
  fields. Therefore the existing **public** Sanity client is sufficient — **no `SANITY_TOKEN`** in the
  chat env. (A buyer-safe selling-points path is a separate future ticket.)
- **Config-as-data / multi-tenant-ready (Decision 1 & 2).** All tunables live in `dealerConfig`.
  Business facts live in a Sanity **document with a `dealer` reference seam** — NOT an enforced
  singleton (a singleton fights the future one-dataset-tagged-by-dealer model; the critic flagged
  this). Resolve "the current dealer's" facts (today: the one doc) so a tenant key drops in later.
- **Do NOT edit `wrangler.jsonc`** (owner-gated scope guardrail). The KV cache is **optional /
  fail-open**: use `GROUNDING_KV` if bound, else read live. Document the binding for the owner to add
  when they want caching.
- **Do NOT touch** `src/chatbot/{state,telegram,config}.ts` behaviour, the AI layer, or unrelated code.
  The `buildListingsQuery` filter refactor (below) is allowed but requires homepage re-verification.

## Architecture

Every AI-reply turn injects a small **always-on overview**; specific turns additionally inject a
**live lookup** of matching cars. Both are deterministic and fail-open.

### 1. Business facts — Sanity `businessInfo` document
- New schema `src/sanity/schemaTypes/businessInfo.ts`, registered in `schemaTypes/index.ts`. Fields:
  `name`, `phone`, `email`, `location`/`address`, `established`/`yearsInBusiness`, `brandsStocked[]`,
  `openingHours` (day/time rows), service toggles+notes (sales/finance/servicing/trade-ins), and a
  Portable Text `extraFacts` block for prose. Include an **optional `dealer` reference field**
  (commented or present-but-unused) as the tenant seam — do not enforce single-document-ness in Studio
  for v1 (optional polish); resolve via the current-dealer helper (today `*[_type=="businessInfo"][0]`).
- `src/chatbot/grounding/business-facts.ts`: fetch via the **public** Sanity client, render to the
  plain-text shape the prompt expects, **KV TTL-cache** the rendered block (if `GROUNDING_KV` bound;
  else live), and **fall back to `BUSINESS_KNOWLEDGE`** when absent. `knowledge.ts` is demoted from
  source-of-truth to degraded fallback (keep the file).

### 2. Inventory overview (always-on, cheap, deterministic)
- `src/chatbot/grounding/overview.ts`: query **active** listings (public fields only — reuse/extend
  `LISTING_FIELDS`, never `dealerNotes`), compute compact **roll-ups** using only reliably-available
  fields: total count, price range (min/max), newest year, and counts by `bodyType`, `fuelType`,
  `transmission`, `driveType`, `condition`, plus a few price bands. (Do NOT parse "make" out of titles
  unless a real field exists.) Render ~200–400 tokens of plain text. KV TTL-cache (optional). This lets
  Rebi answer breadth questions ("do you have SUVs?", "how many under $30k?") cheaply on every turn and
  **backstops any lookup miss** so Rebi is never blind.

### 3. Live lookup (specific turns, deterministic extraction + live query)
- `src/chatbot/grounding/lookup.ts`:
  - **Deterministic extraction** of a `FilterState` from the user message: match enum codes from
    `listings-query.ts` + a small synonym map (`4x4`→`4wd`, `automatic`→`auto`, price `under $40k`/`40k`
    → `priceMax`, `under 80k km`/`low kms` → `odoMax`, seats/`family`→ seat count heuristic, year, etc.).
    Reuse `toFilterState`/`parseFilters` so the result is the same `FilterState` the URL contract uses.
    If nothing meaningful is extracted → return `null` (overview alone will carry the turn).
  - **Live query**: refactor the filter expression out of `buildListingsQuery` (`listings-query.ts`)
    into a shared exported `buildListingsFilter(state)` helper (homepage/partials keep using
    `buildListingsQuery`, which now calls the helper — re-verify the homepage after). Build a
    chat-scoped GROQ: shared filter + `status=="active"` + a **compact public projection** (title,
    price, currency, key `vehicleSpecs`, slug) + optional `title match $kw` (as a GROQ **param**, never
    interpolated) + a hard `[0...N]` slice (N from config, default ~6) + a `count()` for exact totals.
  - Render ≤N compact one-liners + the exact total into a **delimited, instruction-bearing** grounding
    block that tells Rebi: this list is authoritative and live; if empty, say so plainly and never
    invent alternatives; never quote a price/spec not listed.
  - Optional short-TTL (30–60s) KV cache keyed by a hash of the normalized `FilterState`+keywords to
    collapse refinement bursts.

### 4. Prompt assembly (`system-prompt.ts`) — stays a pure function
`buildSystemPrompt(ctx)` where `ctx = { businessFacts, overview, matches? , available }`. Persona +
guardrails unchanged. `# KNOWLEDGE BASE` renders `businessFacts`; a new `# CURRENT INVENTORY` section
renders the overview + (optional) matched block, or a degraded sentinel ("live inventory temporarily
unavailable; point to /listings or the team; do not quote specific stock/prices") when unavailable.
Reinforce the existing anti-injection rules to cover the enlarged context.

### 5. `core.ts` seam — one insertion, correctly placed
- Build the grounded `systemMessage` **after** the human-handoff early-return (`core.ts` ~line 589) and
  only on the AI-reply path (before `generateReply`/`streamChatResponse`, at the `messages` assembly
  ~line 603) — so grounding never runs on handoff/contact-only/both-failed turns. Both the JSON and
  streaming paths consume the same enriched `messages` (build once).
- Wrap all grounding in try/catch → on any error, fall back to today's `buildSystemPrompt()` with static
  knowledge. Add `GROUNDING_KV?: KVNamespaceLike` (optional) to `ChatEnv` and `get-env.ts`, mirroring
  `RATE_LIMIT_KV`. Keep Sanity/KV specifics inside the `grounding/` modules (locally-declared minimal
  interfaces where reasonable) so `core.ts` stays close to portable.

### 6. Config (`dealer.ts`) — new `chat.grounding` block
`{ enabled, overview: { enabled, priceBands }, lookup: { enabled, maxListings, keywordSearch },
cacheTtlSeconds, businessInfoType }` (names illustrative). Everything dealer-tunable; nothing hardcoded.

## Verification (the build agent must do this before reporting)
1. `npx astro check` → 0 errors.
2. `astro dev --background`; confirm the **homepage still renders listings and the Filters drawer works**
   (the `buildListingsQuery` refactor must not regress it).
3. Exercise a chat turn locally (POST `/api/chat`) and confirm: a breadth question is answered from the
   overview; a specific question ("diesel ute under $40k") injects matching cars; a non-inventory
   question ("what are your hours?") still works; and with grounding disabled/failing it degrades to
   today's behaviour. Confirm `dealerNotes` appears nowhere in any response or the injected context.
4. Leave no scratch files.

## Owner follow-ups (not blocking the build)
- Add a `GROUNDING_KV` namespace + `wrangler.jsonc` binding when caching is wanted (code works without it).
- Fill the real business facts into the new `businessInfo` document in Studio.
