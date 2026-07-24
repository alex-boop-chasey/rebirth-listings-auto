# DECISIONS.md — True North & Architecture Decisions

This document records the big directional decisions for Rebirth Listings Auto and — more
importantly — *why* they were made. It's written in plain language, not code, so the project owner
(the "ideas person") can read it any time to confirm the build is still pointed at true north,
without needing to read the code. Any future collaborator, security reviewer, or AI agent should
read this first to understand not just *what* was decided but *why*, so decisions don't get
silently reversed by someone who doesn't know the reasoning.

When a major decision is made or changed, record it here with its reasoning and
the date: /Users/alex/components/rebirth-listings-auto/docs/log.txt

---

## TRUE NORTH (the one-paragraph version)

Rebirth Listings Auto is a world-class car-sales website with AI features as the **core product**,
not bolted on. The near-term goal is to build it as a **single-tenant** site (one dealership —
first target: Bundaberg Motor Group), land that first paying dealer, and prove the product. The
long-term goal is a **multi-tenant SaaS platform** sold to car dealers across Australia for
significant upfront fees plus recurring monthly subscriptions, running as the owner's flagship for
the next ~20 years. Therefore: **build single-tenant now, but keep every door open so the eventual
transition to multi-tenant is an evolution, not a rewrite.** That "keep the doors open" discipline
is the north star. Every decision is checked against it.

---

## Decision 1 — Single-tenant now, multi-tenant-ready, multi-tenant later

**The call:** Build the site to serve one dealership for now, but follow strict conventions so that
converting it to serve many dealerships later is a contained change, not a demolition.

**Why:** The thing that makes this a business is landing the first paying dealer. Building the full
multi-tenant platform before having a single customer would delay revenue to build machinery for a
scale that doesn't exist yet — the classic way solo software founders stall. But building in a way
that *forecloses* multi-tenancy (by hardcoding one dealer's details everywhere) would force an
expensive rewrite later — exactly the "too busy to rebuild" wall the owner wants to avoid.
Single-tenant-but-ready threads that needle: fast to a first sale, no rewrite later.

**What "multi-tenant-ready" concretely means (the conventions we always follow):**
- **Config as data, never hardcoded.** Everything specific to the dealer — name, logo, colours,
  domain, contact details, AI settings, feature toggles — lives in ONE central config object, read
  at runtime. It is never sprinkled through the code as literal values. Today it holds one dealer;
  later it becomes keyed by tenant.
- **No code assumes "the dealer" in a way that can't later take an ID.** Logic refers to "the
  current dealer," resolved from config — not a baked-in name. Today "the current dealer" always
  resolves to the one dealer; later it resolves from the domain.
- **Data is structured so a per-dealer tag can be added later** without restructuring.
- The AI provider layer is already config-driven and feature-scoped, so it's naturally
  tenant-ready.

**Reviewed:** Chosen after considering full multi-tenant now (too much before first revenue) and
pure per-dealer separate repos (creates an unmanageable deployment-drift problem as dealer count
grows — every upgrade would have to be deployed to every dealer's separate codebase individually).

---

## Decision 2 — When we DO go multi-tenant, how dealers' data stays separated

**The call (for the future transition, decided in principle now):** One shared database where every
piece of data is tagged with which dealer owns it, and the "only show a dealer their own data" rule
is enforced in ONE mandatory central checkpoint that every data request must pass through — rather
than trusting each feature to remember the rule.

**Why:** A shared, centrally-guarded database is how most successful multi-tenant SaaS platforms
are built, because it lets a small team serve many customers without drowning in per-customer
maintenance — which is the whole point of the platform. The alternative (a fully separate database
per dealer) is safer against leaks but recreates the per-customer maintenance burden at scale.

**The risk and how it's controlled:** The shared model's danger is a data leak — one dealer seeing
another's cars or customer leads, which would be business-ending and could carry legal weight under
Australian privacy law. This is controlled by structure, not hope:
1. **One mandatory checkpoint** every data request passes through, so the isolation rule can't be
   accidentally skipped — the safe way is the only way.
2. **Automated tests that actively try to break in** (pretend to be dealer A, attempt to read
   dealer B's data, fail loudly if it ever succeeds) — run on every change.
3. **Tenant identity resolved server-side from the domain**, never trusted from user-supplied input
   that could be tampered with.
4. **A paid human security review before any real dealer customer data flows through a
   multi-tenant version.** This is a non-negotiable budget line — standard duty of care for a
   platform holding multiple businesses' data, and the one thing neither the owner nor the AI
   agents can personally catch.

**Status:** Decided in principle. Not built yet (we're single-tenant). Recorded now so the future
transition follows this model rather than being reinvented.

---

## Decision 3 — AI is the core product, and it runs through one provider layer

**The call:** All AI features go through a single internal provider abstraction layer (`src/ai/`).
No feature calls an AI provider directly. Models are chosen per-feature via "capability tiers"
mapped centrally, so swapping or upgrading a model is a one-line change.

**Why:** AI is the differentiator that justifies the price, so it must be built cleanly, not as a
Frankenstein of inline calls. Centralising it means: swap models in one place, control costs
per-feature (cheap models for high-volume features, better models for high-value ones), add
fallbacks so a provider outage doesn't break features, and keep the whole thing future-proof as
better models arrive.

**Cost decision:** Currently routed through OpenRouter, which already reaches every model including
top-tier ones, with consolidated billing. No direct-to-a-single-provider integration — it buys
nothing here and costs more. Free-tier models during the build; paid models switched on only when
revenue justifies them.

---

## Decision 4 — The site is automotive-only (for now)

**The call:** The project began as a multi-vertical template (cars + real estate). Real estate has
been fully removed; this is now an automotive-only product.

**Why:** Focus. The flagship is a car-sales platform. The listing data model still uses flexible
structures that *could* support other verticals later, but the product intent is cars.

---

## Decision 5 — Build for scale from day one where it's cheap to do so

**The call:** Where building the scalable version now costs little extra, do it now rather than
retrofit later (e.g. server-side filtering with pagination built in from the start, even though
current inventory fits on one page).

**Why:** The owner is not on a deadline and would rather build it right once than rebuild under
pressure once the business is busy. Retrofitting scale-critical things (like pagination) into code
that assumed small scale is exactly the kind of rewrite to avoid. This applies where the extra cost
is small; it does NOT mean over-building speculative machinery for scale that may never come (e.g.
we did NOT build the full multi-tenant platform now — see Decision 1).

---

## How we keep pointing at true north

- **This document** records the decisions and reasoning so intent survives across time and across
  many work sessions.
- **The instruction files** (the owner's Project instructions, and `AGENTS.md` for the Claude Code
  agent) carry the tenant-ready conventions as hard rules, so every work session starts already
  knowing them.
- **Enforcement in code** (a lint rule / test) should fail the build if dealer-specific values are
  hardcoded outside the central config — structure beats memory.
- **Periodic audits**: occasionally, a task should audit the codebase against these conventions and
  report any drift.

---

## Working method (how this project is built)

- **The owner** is the ideas/business person, not a coder. They make the high-level business-shaped
  decisions; they do not read or write code. **The owner signs off on every major decision** — no
  significant architectural choice, contest outcome, or irreversible step proceeds without it.
- **The planning & orchestration agent** (you, the main chat agent in the Claude Code CLI) turns the
  owner's decisions into architecture and into a plan for the next phase of each build, then
  **delegates the actual coding to sub-agents running in the background** rather than writing all the
  code itself. It reviews what the sub-agents produce, integrates it, decides contest outcomes, and
  brings every major decision back to the owner for sign-off.
- **Claude Code CLI sub-agents (the coding agents)** do the actual coding in the repo, in the
  background, under the main session's direction — spawned per task with precise scope, reporting back
  for review and integration.
- **Guardrails:** two-phase tickets (investigate/propose, then execute) with owner approval before
  anything irreversible; dry-runs before data writes; delete by explicit ID, never broad matches;
  determinism over guessing.

### The solution contest (a 3-agent tournament, run on request)

Occasionally the owner asks for a **contest** on a hard or open-ended problem. The main session runs
exactly **three sub-agents in sequence** — never in parallel, never scaled up (sequential
divergence-under-constraint works at three and breaks past that):

1. **Agent 1 — first proposal.** Proposes a solution and writes the code for it, compiling/running it
   to prove it works. It finishes completely before anything else starts.
2. **Agent 2 — a deliberately different proposal.** Only after Agent 1 has finished, Agent 2 is briefed
   on Agent 1's result and asked to propose and build a **genuinely different** solution — a different
   approach, not a variation of the first.
3. **Agent 3 — the critic.** Only after Agent 2 has finished, Agent 3 pokes holes in **both**
   proposals — weaknesses, risks, edge cases, trade-offs — and writes a report. It proposes nothing of
   its own.

Then **the main session decides.** Using the plans, code, and critique from all three, it picks the
best solution — which may be one proposal whole, or the best parts of each combined — and **presents
that recommendation to the owner for sign-off before it is implemented.** The sequence is gated: each
step waits for the previous one to finish, so later agents can react to what came before.

Because the owner cannot personally review the code, correctness is protected by structure
(enforced guardrails, automated tests) and, for anything holding real dealer/customer data at
multi-tenant stage, by a paid human expert review before go-live.