# LENSES.md — Doctrinal thinking

This document holds design lenses — durable ways of looking at the product that shape judgment
about what to build and how. Lenses are distinct from `DECISION.md` (which records architectural
choices with their reasoning) and from `AGENTS.md`'s Constraints (which record mechanical rules
that must be followed).

A lens is a pattern of thinking that reveals design implications a narrower view would miss.
Lenses evolve as understanding of the product evolves. Disagreeing with a lens is legitimate and
does not require special justification — a good proposal that appears to violate a lens should
be evaluated on its merits, not rejected for non-conformance. If a lens keeps producing insights,
it earns its place; if it keeps foreclosing good ideas, it should be revised or retired.

New lenses are added here when a pattern of thinking becomes durable enough to be worth naming.
Lenses are not added preemptively.

---

## Lens 1 — AI as the interface

The human shopper is the primary user; the AI is the interface by which they interact with the
site. Classic UI (forms, filter drawers, buttons, static tables) exists as fallback and
complement, not as the primary affordance.

This lens applies to both public-facing (shopper) and dealer-facing (Studio) surfaces. It has
already shaped:

- The hero AI search bar as the primary shopper affordance, with "Or refine manually" as a
  subordinated fallback link to the classic filter drawer.
- The AI-generated listing description button as the primary dealer copy-writing affordance,
  with manual editing preserved as fallback.
- The plan to promote Rebi (currently a demo-stub floating chatbot) into the primary shopper
  conversation surface, accessible from multiple entry points across the site.

The lens is a source of design ideas, not a gate. Applying it to any surface — including
already-shipped classic surfaces like the comparison tray — is legitimate and often reveals
unbuilt features. The comparison tray, for example, was designed as a classic side-by-side table
but under this lens becomes a natural fourth entry point to Rebi ("help me decide between these
three"). That kind of retroactive discovery is the lens working as intended.

Applying it dogmatically to surfaces where the classic pattern genuinely fits better is not
required. A dealer bulk-uploading a CSV of 40 vehicles, for instance, may be better served by a
form-driven flow with AI-assisted validation than by a conversation. The lens asks the question
"is there an AI-first version of this?" — it doesn't demand that the answer always be yes.

This lens is expected to evolve as new surfaces reveal new applications. Future features may
reshape it, and doing so is expected. When a proposal seems to conflict with this lens, that's a
legitimate design conversation, not a policy violation.

---

Space for future lenses. Each new lens should follow the same shape:

- A name that captures the pattern in a few words
- A description of the lens itself (what it asks you to see)
- Concrete examples of where it's already visible in the product
- Honest note on its scope and edges — what it doesn't demand, where it might not apply

Lenses are added when a pattern of thinking has been useful across multiple decisions, not on
first sighting. If a candidate lens turns out to be a Decision or a Constraint in disguise, it
belongs in `DECISION.md` or `AGENTS.md`'s Constraints section instead.