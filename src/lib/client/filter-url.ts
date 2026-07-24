/**
 * Shared client-side filter-URL driver.
 *
 * The URL is the single source of truth (DECISION.md Decision 5). The classic
 * filter drawer drives this flow: build a URL → pushState → fetch the
 * /partials/inventory fragment → swap #inventory-results → refresh the
 * active-filter badge. Extracted into one module so there is exactly one
 * fetch-swap code path and one shared in-flight counter — ready to be reused by
 * any future surface that drives the same filter URL.
 *
 * Imported by the inline <script> of FilterDrawer.astro. In dev (ESM by URL) and
 * prod (a shared Vite chunk) this resolves to a single module instance, so `seq`
 * is shared. The popstate listener is additionally guarded by a window flag so it
 * binds exactly once even if bundling ever duplicates the module.
 */

// In-flight request counter — a newer apply supersedes an older one so a slow
// response can't overwrite the grid with stale results.
let seq = 0;

/**
 * Refresh the active-filter count badge on the drawer trigger — the
 * "Or refine manually" link, or the fallback Filters button; both are
 * id="filters-trigger" and hold a [data-filter-count] span. Derived from the
 * rendered chips so it always matches exactly.
 */
export function updateBadge(): void {
  const badge = document.querySelector<HTMLElement>('#filters-trigger [data-filter-count]');
  if (!badge) return;
  const count = document.querySelectorAll('#inventory-results [data-filter-chip]').length;
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/**
 * Push `url` to history (unless opts.push === false), fetch the inventory
 * partial for it, and swap #inventory-results in place. Falls back to a full
 * navigation on network/enhancement failure.
 */
export async function applyFilterUrl(url: string, opts: { push?: boolean } = {}): Promise<void> {
  const push = opts.push ?? true;
  if (push) window.history.pushState({}, '', url);
  updateBadge();
  const my = ++seq;
  const partialUrl = '/partials/inventory' + new URL(url, window.location.origin).search;
  try {
    const res = await fetch(partialUrl, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error(`partial ${res.status}`);
    const html = await res.text();
    if (my !== seq) return; // a newer apply superseded this one
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const next = doc.getElementById('inventory-results');
    const cur = document.getElementById('inventory-results');
    if (next && cur) {
      cur.replaceWith(next);
      updateBadge();
    }
  } catch {
    // Network/enhancement failure — fall back to a full navigation.
    window.location.href = url;
  }
}

// Back/forward navigation re-syncs the grid from the URL. Guarded so it binds
// exactly once regardless of how many components import this module.
const w = window as unknown as { __filterUrlPopstateBound?: boolean };
if (!w.__filterUrlPopstateBound) {
  w.__filterUrlPopstateBound = true;
  window.addEventListener('popstate', () => applyFilterUrl(window.location.href, { push: false }));
}
