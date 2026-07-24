# Build ticket — chatbot priming/context seam + per-listing "Ask about this car" (v1: "Grounded Focus")

**Status:** approved by owner (with the "name the car" opening). Chosen via a 3-agent solution contest
(A1 proven "context as a grounding block", A2 experimental "Journey Rail", A3 critic). This is the
synthesis: **A1's safe spine + A2's live-data focus resolution, with every bug the critic confirmed
fixed, and the risky/experimental pieces deferred** (logged in `todo.md` → Experience Mode runway).

## Goal
Build the reusable **priming/context seam** and its first caller — a per-listing **"Ask about this
car"** button that opens Rebi already primed to discuss that specific vehicle from live data.
Additive, fail-open, and preserving all existing chatbot behaviour. The same seam must later serve the
compare-drawer and search entry points.

## Non-negotiable constraints
- **Additive / fail-open.** No context ⇒ Rebi behaves **byte-identical to today**. Any resolution
  error ⇒ focus silently omitted. Preserve streaming + `[[ESCALATE]]`/`[[RESOLVED]]` first-line
  buffering, Turnstile, D1 memory, Telegram handoff, contact-only path.
- **No new AI call.** Focus resolution is a deterministic Sanity fetch. All AI still routes through
  `src/ai/`. **No** "open" branch, **no** action channel, **no** new marker vocabulary in v1
  (those are deferred — see bottom).
- **`dealerNotes` excluded** everywhere (public client + explicit projection only).
- **Config-as-data / portable.** New `chat.context` config block; `core.ts`/`context.ts` stay
  framework-agnostic (self-declared minimal types, no Astro import in `core.ts`).

## Design ("Grounded Focus")

### 1. The context object + flow
- New `src/chatbot/context.ts` (portable, zero deps): `ConversationContext = { kind: 'listing' |
  'compare' | 'search'; refs?: string[] }` + `parseContext(raw)` (whitelist `kind`, cap `refs`, drop
  invalid → `null`). **No `openingText` on the server payload** — the opening is client-display-only
  (closes the injection vector the critic flagged).
- The widget sends `context` as one more optional field on the **existing** `/api/chat` POST (beside
  `messages`/`sessionId`/`turnstileToken`). No new endpoint. `core.ts`'s body type + the grounding
  call accept and forward `context`.

### 2. Server-side focus resolution
- New `src/chatbot/grounding/context.ts`, mirroring `lookup.ts`/`overview.ts`: PUBLIC Sanity client,
  explicit public projection (**no `dealerNotes`**), `cachedText`, fail-open (`null` on error).
- Resolve by `_id` (or slug) via the **public** client — drafts are invisible to the token-free
  client, so no draft-surfacing. **Do NOT scope to `status=="active"`**; include `status` so a
  **sold** listing still resolves and Rebi can honestly say it's sold. (Fixes the sold/draft edge.)
- Render a delimited authoritative `CONVERSATION FOCUS` block in the same voice as `renderMatches`
  ("never quote a price or spec not shown here").

### 3. Injection — extend the existing seam, don't fork
- `system-prompt.ts`: add optional `focus?: string | null` to `GroundingContext` + a
  `renderFocusSection`. The no-arg `buildSystemPrompt()` output stays byte-identical.
- `grounding/index.ts` `buildGroundedSystemPrompt(kv, userText, context?)` resolves focus and passes
  it through. **Decouple focus from `grounding.enabled`:** restructure so focus is still produced when
  inventory grounding is off but `chat.context.enabled` is on (the critic's coupling bug — don't let
  `if(!cfg.grounding.enabled) return null` also suppress priming).
- **Placement:** focus is built in the grounding call (~`core.ts:619`), which is **after** the
  escalated/human-active + contact-only early-returns → priming never runs during a handoff. Keep it
  there. Do **not** add an "open" branch (avoids A2's speak-over-the-team risk).

### 4. The primed opening (v1: name the car, client-side)
- When the widget opens **with an active context**, render a canned assistant bubble that **names the
  car** (from `data-rebi-title`) e.g. *"Happy to help with the 2021 Ford Ranger XLT — want to know
  about its price, kilometres, features, or booking a look?"* Name only — **no price/figures**
  (avoids the stale-build-time-price contradiction). No AI call, no server round-trip, no rate-limit
  cost. Live focus data kicks in on the visitor's first real message.
- **CRITICAL shared bug fix (both proposals missed it):** the widget **always** renders the default
  `GREETING` first in `renderHistory` (and `renderFromServer`). The primed greeting must **replace**
  the default greeting when a context greeting is active — edit `renderHistory`/`renderFromServer` so
  a primed open shows exactly **one** greeting and rehydrate doesn't double it.

### 5. Continuity (v1 = client; staged path to server)
- Keep the session (never mint fresh). Client holds `activeContext`, mirrors to `sessionStorage`, and
  re-sends `{kind,refs}` each turn until changed or the chat ends.
- **FIX:** clear `activeContext` + its storage key in `newChat()` (the critic's stale-context bug).
- Accept **per-tab** scope for v1 (fine for a single "ask about this car" conversation). True
  cross-tab / returning / cross-device continuity is the **server-persisted journey** deferred to the
  compare/search phase — the focus-injection seam is identical, so that's a later source swap
  (client → server), not a redesign.
- Soft prompt framing ("treat this vehicle as the subject unless they clearly move on") so a stale
  focus deep in a conversation de-emphasises naturally.

### 6. The button
- In `src/pages/listings/[slug].astro`, alongside Contact/Save:
  `<button data-rebi-open data-rebi-kind="listing" data-rebi-ref={listing._id}
  data-rebi-title={listing.title}>Ask about this car</button>`.
- Wiring lives **inside `ChatWidget.astro`** via a delegated document click listener (the
  `ContactModal`/`CompareTray` precedent). On click: set `activeContext`, open the panel with the
  primed greeting.

### 7. Config
- New `chat.context` block in `dealer.ts`: `{ enabled, allowedKinds, maxRefs, cacheTtlSeconds }`.
  Dealer-tunable, multi-tenant-ready.

## Files
- **Add:** `src/chatbot/context.ts`, `src/chatbot/grounding/context.ts`.
- **Change:** `src/chatbot/system-prompt.ts` (`focus?` + render), `src/chatbot/grounding/index.ts`
  (resolve focus; decouple from `grounding.enabled`), `src/chatbot/core.ts` (parse + forward context;
  body type), `src/components/widgets/ChatWidget.astro` (activeContext, delegated listener, primed
  greeting replacing GREETING in `renderHistory`/`renderFromServer`, `context` in `basePayload`, clear
  in `newChat`), `src/pages/listings/[slug].astro` (button), `src/config/dealer.ts` (`chat.context`).

## Verify (the build agent must do this before reporting)
1. `npx astro check` → 0 errors.
2. `astro dev --background`, then in the browser (or via curl to `/api/chat`):
   - Open a listing → click "Ask about this car" → widget opens with **exactly one** greeting naming
     that car (no duplicate).
   - Ask "what's the price / how many km?" → answered from live focus data.
   - Ask an unrelated business question ("opening hours?") → still works.
   - End the chat (newChat) → context cleared; the next plain launcher open is **identical to today**
     (default greeting, no focus).
   - A **sold** listing → Rebi acknowledges it's sold (status resolved).
   - Confirm `dealerNotes` appears in no response or injected context (`grep`).
3. Leave no scratch files. Do NOT commit — leave changes in the working tree for review.

## Deferred (logged in `todo.md` → Experience Mode runway)
AI-speaks-first streamed opening; server-persisted D1 **journey** (real cross-surface continuity —
lands with the compare + search entry points); URL-addressable primed states; the chat-drives-the-page
action channel.
