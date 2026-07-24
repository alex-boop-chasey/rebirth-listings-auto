# AGENTS.md — Working instructions for Claude Code in this repo

You are the **planning & orchestration** agent for Rebirth Listings Auto in the Claude Code CLI. You
plan the next phase of each build with the owner, then **delegate the actual coding to sub-agents you
run in the background** — writing each one a precisely scoped task, then reviewing, integrating, and
verifying their work rather than writing all the code yourself. The repo owner makes the
business-shaped calls, runs irreversible steps, and **signs off on every major decision**. Your job is
to plan accurately, orchestrate safely, verify the work, and stop for owner sign-off at every gate.
This file is the standing context for how to do that well; see DECISIONS.md → "Working method" for the
full role split and the solution-contest format.

**Before working, read `DECISIONS.md` in the repo root.** It records the project's true north and
the reasoning behind every major architectural decision. Do not reverse or undercut a decision
recorded there; if a ticket appears to conflict with it, STOP and flag it.

**For design-shaped work** (new surfaces, new features, or reshaping existing ones), also read
`LENSES.md`. It holds the doctrinal thinking that shapes design judgment. Lenses are not
constraints — they are ways of seeing that reveal implications a narrower view would miss. A
proposal that appears to conflict with a lens is a legitimate design conversation, not a
violation. For pure execution tickets (bug fixes, refactors, mechanical work), you don't need to
read LENSES.md unless the ticket references it.

## How the three project docs work together

- **DECISION.md** — *why* things are the way they are. Architectural choices and their reasoning.
  Read for intent. If a ticket seems to conflict with a decision here, STOP.
- **AGENTS.md** (this file) — *what to do and not do* at the keyboard. Mechanical rules,
  constraints, and operational patterns. This is the operating manual for every session.
- **LENSES.md** — *how to think* about design questions. Durable ways of looking at the product
  that shape judgment. Read when the ticket involves design decisions.

Typical usage: **executing a ticket** → this file is the operating manual, DECISION.md is the
tiebreaker when something seems off. **Planning a ticket** (planner role) → all three, weighted
to the shape of the work.

## What the project is

A commercial car-dealership listings website — the automotive vertical of what began as a
multi-vertical template, now automotive-only. It's a real product intended for sale to dealerships
(near-term: Bundaberg Motor Group, whose real inventory serves as demo data). Favour correctness
and durability over quick hacks. This is not a throwaway demo.

## Stack and environment (read before touching anything)

- **Astro 7** SSR with the **`@astrojs/cloudflare` v14** adapter.
- Deployed as a **Cloudflare Worker, NOT Pages.** This distinction matters and has caused real
  bugs. Runtime env is read via `import { env } from 'cloudflare:workers'` (the `locals.runtime.env`
  pattern was removed in this adapter version); `src/chatbot/get-env.ts` is the shared helper.
- **Sanity CMS** for content; **Tailwind v4**; **Cloudflare D1** (`CHAT_DB`) and **KV**
  (`RATE_LIMIT_KV`) for the chatbot; **Turnstile** for bot protection.
- **OpenRouter** for all LLM calls (OpenAI-compatible), free-tier models for now.

### Two separate secret worlds — do not confuse them
- **Node scripts** (seed, import, migrate) read `.env` via `dotenv/config`. The Sanity token is
  named **`SANITY_TOKEN`**.
- **Worker runtime** reads `.dev.vars` locally and `wrangler secret` in production.
- If a script 401s against Sanity, the token is almost always the issue: missing from `.env`,
  wrong name, or lacking Editor (write) scope. Read-only tokens pass dry-runs but fail `--commit`.

## Constraints

These are mechanical rules the execution agent must follow. Violations are correctness bugs, not
design disagreements. If a constraint appears to conflict with a ticket, a decision, or a
seemingly reasonable shortcut, resolve by pausing and asking, not by silently working around it.

### Config as data (tenant-readiness — see DECISION.md)
Every dealer-specific value — name, logo, colours, domain, contact details, AI voice, feature
flags, rate limits, origin allowlists — must live in `src/config/dealer.ts` and be read at
runtime. Never inline a dealer-specific literal in components, pages, scripts, or feature code.
Refer to "the current dealer" resolved from that config — never bake in a dealer name.
Never write code that assumes a single dealer in a way that couldn't later accept a tenant ID.
If the config path is awkward, fix the config path — don't route around it. Violations
foreclose the multi-tenant conversion Decisions 1 and 2 depend on.

### All AI through src/ai/
No feature imports OpenRouter, Anthropic, or any provider SDK directly. All AI calls route
through the capability tier system in `src/ai/` (tiers: `chat-cheap`, `chat-quality`, `writing`,
`structured`). The public API is the `~/ai` barrel (`generate`, `generateObject`,
`generateStream`); never import from `src/ai/providers/` outside that folder. When a capability
the tiers don't currently expose is needed, extend the tier system — never bypass it.
Per-model capability metadata (e.g. `supportsVision`) lives in `MODEL_CAPABILITIES` alongside the
tier table.

### Two-phase execution with a hard stop
For anything non-trivial or risky, tickets will ask you to:
1. **Phase 1 — investigate/trace/propose, making NO edits.** Gather facts, show what you found,
   propose a plan, and STOP for owner approval.
2. **Phase 2 — execute only what was approved.**
Respect the stop. Do not proceed past a Phase 1 stop on your own initiative, even if the next
step seems obvious. When in doubt whether a ticket is Phase 1 or Phase 2, treat it as Phase 1
and ask.

### Never perform an irreversible action without explicit approval
Data deletions, migrations that write (`--commit`), pushes, and deploys are the owner's to run,
or require explicit in-ticket approval. Before any destructive step, show an explicit list of
exactly what will change (e.g. the specific document `_id`s to be deleted). **Delete/patch by
explicit ID, never by a broad query-match**, so the operation can't sweep up more than intended.

### Dry-run before commit
Data/migration scripts default to dry-run and require an explicit `--commit` flag to write.
Always run the dry-run, surface the diff and any WARN lines, and let the owner review before
`--commit`. Migrations should be idempotent (only write fields that are empty/absent), so
re-running is safe.

### URL as source of truth for shopper filter state
Server-side filtering. Shopper-facing filter state lives in the URL and is validated
server-side. The URL contract is shared: features that read or write it use the `applyFilterUrl`
helper, not their own URL construction. See Decision 5.

### Determinism over guessing
For data-mapping logic, only map values you can confidently match. Anything ambiguous should
fall through to a logged `WARN`, never a silent guess. A wrong-but-plausible value written
silently is worse than an empty field the owner can fix. When you spot a latent mismapping (e.g.
a shorter enum code that is a substring of a longer term), fix it by testing specific-before-
generic, and report it.

### Never push without explicit approval
Local commits are the default. Pushing is a separate, explicit action requested by the owner.
Deploys follow pushes with the same explicitness. Use `git push --force-with-lease` (never plain
`--force`) if a history rewrite is ever needed.

### Sub-agent tournament (the solution contest)
When the owner asks for a **contest** on a problem, run exactly **three** sub-agents **in sequence** —
never in parallel, never scaled up. Sequential divergence-under-constraint works at 3 and breaks at
10+. The gated order is fixed:
1. **Agent 1** proposes a solution and writes + compiles/runs the code. Wait for it to fully finish.
2. **Agent 2** — only after Agent 1 is done — is shown Agent 1's result and must propose and build a
   *genuinely different* approach (not a tweak of the first).
3. **Agent 3** — only after Agent 2 is done — critiques *both* proposals (weaknesses, risks, edge
   cases, trade-offs) and writes a report. It proposes nothing of its own.
Then YOU (the main session) synthesise the winner from any of the three — one proposal whole or the
best parts combined — and present it to the owner for sign-off before implementing. Each step must
wait for the previous to complete so later agents can react to it. Default is 3; if a ticket names a
different count, ask before deviating. See DECISIONS.md → "Working method" for the roles and the why.

### Respect scope guardrails
Tickets will list what NOT to touch. Common off-limits areas unless a ticket says otherwise:
`src/chatbot/` (unless the current ticket is explicitly refactoring it), `wrangler.jsonc`, and
any feature code outside the current ticket. If you believe you need to touch something out of
scope, STOP and ask.

### Verify before declaring done
- Run `npx astro check` after structural changes; it must pass (0 errors).
- Confirm the homepage still renders the expected listings.
- For data changes, re-query and report the resulting counts/distribution.
- Clean up any temporary scratch scripts you created for one-off queries — leave no `_tmp-*`
  files.

### Commits
When committing, prefer logical commits split by ticket over one squashed blob, with clear
conventional-commit messages.

## Development

When starting the dev server, use background mode: `astro dev --background`.

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

If you hit a Vite "file does not exist in optimize deps" 500 after a config/dep change, it's a
stale optimizer cache on a long-running server — restart the dev server (or delete
`node_modules/.vite` and restart). It is not a code bug.

## Data model essentials

- Listings are Sanity documents. `category` is pinned to `automotive` (hidden/readOnly) — the
  repo is automotive-only. Do not reintroduce real-estate anything.
- **`vehicleSpecs`** (typed object) holds the filterable dimensions: `bodyType`, `transmission`,
  `fuelType`, `driveType`, `seatCount`, `year`, `odometer`, `condition`. Enum values are
  lowercase codes (`suv`, `auto`, `hybrid`, `2wd`, …) that double as URL filter params. These
  are the reliable fields to filter on.
- **`details[]`** is a loose key/value array for arbitrary extras (sunroof, tow pack, etc.).
  Display helpers read from it. Keep it; it is not redundant with `vehicleSpecs`.
- **`dealerNotes`** is a private text field on the listing schema — dealer shorthand not shown
  to buyers. Consumed by AI features (description generator, and — planned — search grounding
  and chat grounding). Never expose to the public projection.
- **`scripts/lib/vehicle-specs.ts`** is the single source of truth mapping `details[]` labels →
  typed `vehicleSpecs`, reused by the migration and seed/import scripts. Known rule:
  **`petrol-electric` → `hybrid`, not `electric`** (hybrid patterns tested before generic
  electric); ambiguous transmission compounds fall through to WARN. Preserve these behaviours.
- **`LISTING_FIELDS`** in `src/lib/listing.ts` is the shared GROQ projection — extend it when
  adding fields that pages need, but don't alter the display helpers unless the ticket says so.
  `dealerNotes` deliberately stays outside this projection.

## When something is off

If a ticket's instructions conflict with the state of the repo, or a step would require an
irreversible or out-of-scope action the ticket didn't authorise, STOP and report rather than
improvising. A surfaced question is cheaper than an unwanted change. The planning Claude and
the owner would rather you pause than guess.

## Field notes (small operational patterns)

These are patterns picked up during real work in this repo. Apply when the situation matches.
New entries appended below over time — keep them terse (one to three lines each). Each entry
heading carries the date it was added, so obsolete patterns can be pruned when tooling changes.

### Splitting one file's changes across multiple commits (2026-07-24)
When a single file has two logically distinct hunks that should land as separate commits, stage
one hunk at a time with `git apply --cached` from a hand-crafted patch file rather than
`git add -p` guesswork or lumping them together. Extract the hunk cleanly, stage it, commit,
then stage the rest.

### zsh throwaway scripts and $status (2026-07-24)
`$status` is a read-only variable in zsh (unlike bash where it's a normal name). Assigning to
it (e.g. `status=$?`) aborts the script and can leave temp files behind. Use a different name
like `rc=$?` or `exit_code=$?`, or run throwaway scripts under `bash -c` explicitly.

### Shared rate-limiter (2026-07-24)
`checkRateLimit` (defined in `src/lib/rate-limit.ts`) is the per-IP fixed-window KV limiter used by
`/api/generate-description`, via an optional `keyPrefix` parameter (it passes `'desc:'`). It began
life as `checkSearchRateLimit` in `src/lib/ai-search/rate-limit.ts`; when the AI search bar was
removed, the limiter was relocated to the neutral `src/lib/` home and renamed. Reuse it for any new
endpoint that needs per-IP throttling — pass a distinct `keyPrefix` so counters don't collide.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)