#!/usr/bin/env bash
#
# Guardrail: nothing OUTSIDE src/ai/ may import from src/ai/providers/*.
#
# The providers/ directory is the AI layer's internal implementation. Callers
# must go through the public surface (`~/ai`) so they can't bypass tier
# fallback, the config seam, or structured-output handling. Files inside src/ai/
# are allowed to reach providers/ (that's the layer wiring itself up).
#
# No ESLint is configured in this repo, so this shell check stands in for a
# `no-restricted-imports` rule. Run it manually or from CI:
#
#     npm run check:ai-imports
#
# Exits 0 when clean, 1 (and prints the offenders) when a violation is found.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# A quoted import/require/dynamic-import specifier that points into ai/providers.
# External callers reach it as `~/ai/providers/...` or `../ai/providers/...`;
# both contain the literal `ai/providers/`. Internal files use `./providers/...`
# (no `ai/` prefix) and are excluded below as a belt-and-suspenders measure.
PATTERN="(from|import\(|require\()[[:space:]]*['\"][^'\"]*ai/providers/"

violations="$(grep -rnE "$PATTERN" \
  --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.js' --include='*.mjs' \
  src scripts 2>/dev/null | grep -v '^src/ai/' || true)"

if [ -n "$violations" ]; then
  echo "❌ Forbidden import of src/ai/providers/ from outside the AI layer:"
  echo ""
  echo "$violations"
  echo ""
  echo "Import from '~/ai' (the public surface) instead. src/ai/providers/ is internal to the layer."
  exit 1
fi

echo "✓ No forbidden src/ai/providers/ imports outside src/ai/."
