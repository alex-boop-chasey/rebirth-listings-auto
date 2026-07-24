# TODO — Rebirth Listings Auto

> Tracks the open threads for the chatbot pipeline and the longer-term product direction.

## Shipped so far

- [x] Removed the old AI natural-language search bar (salvaged its design into `docs/ai-natural-language-search-reference.md`).
- [x] Codified the working method in DECISIONS.md / AGENTS.md: main chat = planner/orchestrator, sub-agents do the coding, plus the sequential 3-agent "solution contest" format.
- [x] Shipped chatbot grounding ("Overview + Live Lookup", chosen via a 3-agent contest): Rebi now answers from the live Sanity inventory (always-on overview + per-question live lookup, deterministic, no extra AI call) and a dealer-editable business-facts document. Merged to main. Spec/record in `docs/proposals/chatbot-inventory-grounding.md`.

## Now — next build (the chatbot as the site's AI hub)

- [ ] **Build the priming/context seam** (the shared mechanism): a way to open Rebi with an invisible "conversation context" attached (mode + optional listing IDs + optional opening text). The server injects it as an invisible system-prompt segment and resolves listing IDs to authoritative live data (reuse the grounding just shipped). All three entry points below are thin callers of this one seam.
- [ ] **Entry point 1 — per-listing "Ask about this car"** button on a single listing. Smallest caller; build first to prove the seam end-to-end.
- [ ] **Entry point 2 — compare-drawer "Ask AI"** button. Passes the selected car IDs (the drawer already tracks them); Rebi opens primed to compare those specific cars.
- [ ] **Entry point 3 — rebuild the plain-English search as a chat entry.** Results-first UX: submit plain English → loading loop → results appear under a "Results" heading and the search bar disappears → Rebi slides in with something like "Here are your results. Did you want to change anything or look deeper?" plus buttons to keep searching / close. Search is *operational* (interprets intent, drives the filter grid, may ask a clarifying question) — unlike the conversational listing/compare entries. Head start: the salvaged extractor + confidence/clarify pattern in `docs/ai-natural-language-search-reference.md`.

### ⭐ North Star — continuity

One ongoing Rebi session across search → listing → compare that *accumulates* context (the "familiar little AI friend"), not a fresh bot per entry point. Use the existing D1 session memory. Auto-opens should feel like a gentle slide-in, not a takeover.

## Owner tasks (not blocking dev)

- [ ] Fill the real business facts into the new "Business info" (`businessInfo`) document in Sanity Studio — phone, hours, brands stocked, years in business, address, services. Until then Rebi uses the `knowledge.ts` placeholder (works, just generic).
- [ ] Optional: add a `GROUNDING_KV` KV namespace + a `wrangler.jsonc` binding to enable grounding caching (runs fine live without it).

## Loose ends

- [ ] Fix the 5 stale `DECISION.md` → `DECISIONS.md` references now that the file is plural: 3 in AGENTS.md (around lines 25, 32, 66) and 2 in LENSES.md (around lines 4, 63).
- [ ] Restart Claude Code to stop the leftover SuperWhisper hook errors (the plugin was de-registered this session, but its hooks stay loaded until a restart).
- [ ] Optional: delete `/Applications/superwhisper.app` and the now-orphaned SuperWhisper plugin cache dirs (`~/.claude/plugins/cache/superwhisper`, `~/.claude/plugins/marketplaces/superwhisper`) if you're truly done with it.

## Later / product direction

- **Buyer-safe "selling points" path:** a curated listing field (or a reply scrub) so Rebi can use dealer selling points without ever exposing the raw, private `dealerNotes` (deliberately deferred from chat v1).
- **Extract the chatbot kernel** — the framework-agnostic core + a pluggable grounding interface — into its own clean repo. That's the reusable product, not the whole dealership site.
- **The big vision:** a "plug into any website" AI helper that navigates large sites and answers questions about specific parts. The grounding source swaps from the Sanity catalog to website content — via a structural site-map index (page/section → short summary the AI walks) and/or semantic RAG, with delta-refresh on change. Possible moat: also make authoring AI-ready content tags effortless (a CMS pattern), so new content ships AI-findable by default.
- **Experience Mode (flagship "the chatbot IS the website"):** an opt-in premium mode where the AI navigator is the primary way to move through the site and the screen is a canvas the bot drives — "let me put that on the display now" → the page/grid/comparison appears. First-time visitors get a short onboarding (~5s clip/animation) explaining how to use it, with a frictionless **opt-out to the standard browsable site**; then a standby screen where a named, characterful **navigator** greets them and takes requests. Framed as fun/discovery ("what will you find?") rather than pure utility — a memorable, brandable experience best suited to big brands. **A dial, not a binary:** the normal browsable site stays underneath as the accessibility + SEO floor. Remember returning visitors and prior opt-outs (never re-onboard). Prototype the onboarding → standby → "boom" flow cheaply and test with ~5 real users early, since the delight-vs-annoyance line is thin and personal. Built on the same priming-seam + entry-points engine, dialled all the way up.

## ⭐ Milestone — fork a set-in-stone snapshot at 100%

**Once the chatbot pipeline is at 100% — all three entry points built, continuity working, verified and stable — FORK / COPY the repo exactly as it stands to create a frozen, "set in stone" snapshot.**

This gives us a complete, ready-to-go base to branch the "plug into any website" AI-helper product from later. Do this AT that 100% milestone (not before), so the snapshot captures the finished, working chatbot rather than a half-built one.

> Note: this is a full copy/fork of the repo at that point — distinct from the "extract the kernel into its own repo" task above, which is the later cleanup step.
