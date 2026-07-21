import { urlFor } from '../sanity/lib/image';
import { dealerConfig } from '../config/dealer';

// --- Types -------------------------------------------------------------------

export interface ListingDetail {
  _key: string;
  label: string;
  value: string;
  valueType: 'text' | 'number' | 'boolean' | 'date';
  valueNumber?: number;
  unit?: string;
  valueBoolean?: boolean;
  valueDate?: string;
}

// Typed, first-class automotive filter dimensions. Populated alongside (not
// instead of) `details[]`; the search + filter feature queries these by their
// lowercase enum codes. All optional — a listing may not know every value.
export interface VehicleSpecs {
  bodyType?: 'sedan' | 'hatchback' | 'suv' | 'ute' | 'wagon' | 'van' | 'coupe' | 'convertible';
  transmission?: 'auto' | 'manual';
  fuelType?: 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'lpg';
  driveType?: '2wd' | 'awd' | '4wd';
  seatCount?: number;
  year?: number;
  odometer?: number;
  condition?: 'new' | 'used' | 'demo';
}

export interface Listing {
  _id: string;
  title: string;
  slug: { current: string };
  description?: unknown[];
  price: number;
  currency: string;
  status: 'active' | 'sold' | 'pending' | 'draft';
  images?: Parameters<typeof urlFor>[0][];
  category: string;
  details?: ListingDetail[];
  vehicleSpecs?: VehicleSpecs;
  listingDate?: string;
}

// --- Shared GROQ projection --------------------------------------------------
// The full field set every listing query needs. Kept in one place so the
// projection can't drift between index.astro, [slug].astro and compare.astro.
export const LISTING_FIELDS = `_id, title, slug, description, price, currency, status, images, category,
  details[]{ _key, label, value, valueType, valueNumber, unit, valueBoolean, valueDate },
  vehicleSpecs{ bodyType, transmission, fuelType, driveType, seatCount, year, odometer, condition }, listingDate`;

// --- Formatting helpers ------------------------------------------------------

export function formatPrice(price: number, currency: string): string {
  // No/zero price = "price on application" — show a human label instead of "$0".
  if (!price || price <= 0) return 'Contact agent';
  // Locale and default currency are dealer/region-specific — resolved from the
  // central dealer config (DECISION.md Decision 1), not hardcoded. A per-listing
  // currency still wins when present.
  return new Intl.NumberFormat(dealerConfig.locale.locale, {
    style: 'currency',
    currency: currency || dealerConfig.locale.currency,
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function categoryLabel(category: string): string {
  return (category ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const statusConfig = {
  active: { label: 'Active', badge: 'bg-emerald-500' },
  pending: { label: 'Pending', badge: 'bg-amber-500' },
  sold: { label: 'Sold', badge: 'bg-red-600' },
  draft: { label: 'Draft', badge: 'bg-slate-400' },
} as const;

export function detailDisplay(d: ListingDetail): string {
  if (d.valueType === 'boolean') return d.valueBoolean ? 'Yes' : 'No';
  if (d.valueType === 'number' && d.valueNumber != null) {
    // With a unit, format the raw number nicely (e.g. "142,000 km"); without a
    // unit, prefer the human-readable value so plain figures like years stay
    // separator-free (e.g. "2019", not "2,019").
    if (d.unit) return `${d.valueNumber.toLocaleString('en-AU')} ${d.unit}`;
    return d.value ?? d.valueNumber.toString();
  }
  return d.value ?? '';
}

// --- Inline SVG icon system (no external libraries) --------------------------
// All icons share a 16x16 viewBox, currentColor stroke, no fill.
export const icons: Record<string, string> = {
  gauge:
    '<circle cx="8" cy="9" r="5.5"/><path d="M8 9l2.6-2.2"/><path d="M8 3.5v1"/><path d="M3.2 9h1"/><path d="M11.8 9h1"/>',
  calendar:
    '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11"/><path d="M5.5 2v3"/><path d="M10.5 2v3"/>',
  cog:
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
  droplet: '<path d="M8 2C8 2 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 2 8 2z"/>',
  badge:
    '<path d="M8 1.8l1.7 1.2 2 .1.6 1.9 1.6 1.2-.7 1.9.7 1.9-1.6 1.2-.6 1.9-2 .1L8 14.2l-1.7-1.2-2-.1-.6-1.9L2.1 9.8l.7-1.9-.7-1.9 1.6-1.2.6-1.9 2-.1z"/><path d="M5.8 8l1.6 1.6L10.4 6.6"/>',
  bed:
    '<path d="M2 4v8"/><path d="M2 8.5h12v3.5"/><path d="M2 8.5V6a1.5 1.5 0 0 1 1.5-1.5H14"/><path d="M5 8.5V7a.5.5 0 0 1 .5-.5H8"/>',
  bath:
    '<path d="M2.5 8.5h11"/><path d="M3 8.5v2A2 2 0 0 0 5 12.5h6a2 2 0 0 0 2-2v-2"/><path d="M4 8.5V4a1.5 1.5 0 0 1 2.6-1"/><path d="M5.5 4.2h1.6"/><path d="M4.5 12.5l-.6 1.3M11.5 12.5l.6 1.3"/>',
  ruler:
    '<rect x="2" y="6" width="12" height="4" rx="1" transform="rotate(-45 8 8)"/><path d="M6.6 5.2l.9.9M8.5 3.3l.9.9M4.8 7l.9.9"/>',
  home:
    '<path d="M2.5 7.5L8 3l5.5 4.5"/><path d="M4 6.8v6h8v-6"/><path d="M6.8 12.8V9.5h2.4v3.3"/>',
  waves:
    '<path d="M2 6c1.2 0 1.2 1 2.4 1S5.6 6 6.8 6 8 7 9.2 7s1.2-1 2.4-1 1.2 1 2.4 1"/><path d="M2 9.5c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1S8 10.5 9.2 10.5s1.2-1 2.4-1 1.2 1 2.4 1"/>',
  tag:
    '<path d="M2.5 8.3V3.5A1 1 0 0 1 3.5 2.5h4.8a1 1 0 0 1 .7.3l4.4 4.4a1 1 0 0 1 0 1.4l-4.8 4.8a1 1 0 0 1-1.4 0L2.8 9a1 1 0 0 1-.3-.7z"/><circle cx="5.5" cy="5.5" r=".8"/>',
  car:
    '<path d="M2.5 10.5h11"/><path d="M3 10.5V8l1.4-3.2a1 1 0 0 1 .9-.6h5.4a1 1 0 0 1 .9.6L13 8v2.5"/><path d="M3 8h10"/><circle cx="5" cy="10.8" r="1.2"/><circle cx="11" cy="10.8" r="1.2"/>',
  building:
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5.5 5h1.5M9 5h1.5M5.5 7.5h1.5M9 7.5h1.5M5.5 10h1.5M9 10h1.5"/><path d="M6.8 13.5v-1.5h2.4v1.5"/>',
  check: '<path d="M3 8.2l3 3 7-7"/>',
  cross: '<path d="M4 4l8 8M12 4l-8 8"/>',
  filter: '<path d="M2.5 3.5h11L9 8.4v4.1l-2 1V8.4z"/>',
  arrow: '<path d="M3 8h9"/><path d="M8.5 4.5L12 8l-3.5 3.5"/>',
  arrowLeft: '<path d="M13 8H4"/><path d="M7.5 4.5L4 8l3.5 3.5"/>',
  heart:
    '<path d="M8 13.3l-.9-.8C4 9.6 2 7.8 2 5.6 2 3.9 3.3 2.6 5 2.6c1 0 1.9.5 2.5 1.2l.5.6.5-.6C9.1 3.1 10 2.6 11 2.6c1.7 0 3 1.3 3 3 0 2.2-2 4-5.1 6.9l-.9.8z"/>',
  image:
    '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M3 11.5l3-2.5 2.5 2 2-1.5 2.5 2.5"/>',
};

export function iconSvg(name: string, cls = 'h-3.5 w-3.5'): string {
  const body = icons[name] ?? icons.tag;
  return `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function detailIconName(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('odometer') || l.includes('mileage')) return 'gauge';
  if (l.includes('year') || l.includes('available') || l.includes('date') || l.includes('built')) return 'calendar';
  if (l.includes('transmission') || l.includes('gearbox')) return 'cog';
  if (l.includes('fuel')) return 'droplet';
  if (l.includes('registered') || l.includes('rego')) return 'badge';
  if (l.includes('bedroom')) return 'bed';
  if (l.includes('bathroom')) return 'bath';
  if (l.includes('land') || l.includes('size') || l.includes('area')) return 'ruler';
  if (l.includes('property') || l.includes('type')) return 'home';
  if (l.includes('pool')) return 'waves';
  return 'tag';
}

// Automotive-only dataset — every listing is a vehicle. The parameter is kept
// for call-site stability but no longer branches on category.
export function categoryIconName(_category?: string): string {
  return 'car';
}

// --- Comparison winner heuristic (hardcoded for the demo) --------------------
// For a numeric comparison row, is a lower value the "winner"? Odometer, price
// and kilometres favour lower; everything else (bedrooms, land size, …) defaults
// to higher-is-better.
export function isLowerBetter(label: string): boolean {
  const l = (label ?? '').toLowerCase();
  return ['odometer', 'price', 'kilometre', 'mileage'].some((k) => l.includes(k));
}
