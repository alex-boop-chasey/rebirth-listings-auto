import type { Template } from 'sanity';

/**
 * Automotive listing vocabulary — the ordered spec labels for an automotive
 * listing. Array order = display order on the site.
 */
export const AUTOMOTIVE_SPEC_LABELS: ReadonlyArray<{
  label: string;
  valueType: 'text' | 'number' | 'boolean' | 'date';
  unit?: string;
}> = [
  { label: 'Make', valueType: 'text' },
  { label: 'Model', valueType: 'text' },
  { label: 'Badge', valueType: 'text' },
  { label: 'Series', valueType: 'text' },
  { label: 'Model Year', valueType: 'number' },
  { label: 'Colour', valueType: 'text' },
  { label: 'Odometer', valueType: 'number', unit: 'km' },
  { label: 'Body', valueType: 'text' },
  { label: 'Engine', valueType: 'text' },
  { label: 'Fuel Type', valueType: 'text' },
  { label: 'Transmission', valueType: 'text' },
  { label: 'Drive Type', valueType: 'text' },
  { label: 'Doors', valueType: 'number' },
  { label: 'Seats', valueType: 'number' },
  { label: 'Trim', valueType: 'text' },
  { label: 'VIN', valueType: 'text' },
  { label: 'Registration Plate', valueType: 'text' },
  { label: 'Registration Expiry', valueType: 'date' },
  { label: 'Build Date', valueType: 'date' },
  { label: 'Compliance Date', valueType: 'date' },
  // Stock Number is text, not number, so leading zeros survive.
  { label: 'Stock Number', valueType: 'text' },
];

const slugify = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Label slug + short random suffix — unique within the array and collision-safe
// even if an editor later duplicates a scaffolded row.
const detailKey = (label: string) => `${slugify(label)}-${Math.random().toString(36).slice(2, 8)}`;

const details = AUTOMOTIVE_SPEC_LABELS.map((spec) => ({
  _key: detailKey(spec.label),
  _type: 'detail' as const,
  label: spec.label,
  valueType: spec.valueType,
  // unit only where the vocabulary specifies one; no value fields are set so
  // editors fill them in.
  ...(spec.unit ? { unit: spec.unit } : {}),
}));

export const automotiveListingTemplate: Template = {
  id: 'listing-automotive',
  title: 'Listing (Automotive)',
  schemaType: 'listing',
  value: {
    category: 'automotive',
    status: 'active',
    currency: 'AUD',
    details,
  },
};
