import 'dotenv/config';
import { createClient } from '@sanity/client';
import { randomUUID } from 'node:crypto';
import { AUTOMOTIVE_SPEC_LABELS } from '../src/sanity/templates/automotive';
import { specsFromDetails } from './lib/vehicle-specs';

const client = createClient({
  projectId: process.env.PUBLIC_SANITY_PROJECT_ID!, dataset: process.env.PUBLIC_SANITY_DATASET!,
  apiVersion: process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01', token: process.env.SANITY_TOKEN, useCdn: false,
});

const IMAGE_REF = 'image-4b8169efa3be95f131678f653a1f9f437c1d9bea-1500x1125-jpg'; // reused from import-bundaberg-517075
const randKey = () => randomUUID().replace(/-/g, '').slice(0, 12);

// Made-up test values keyed by the canonical vocabulary.
const made: Record<string, string | number | undefined> = {
  Make: 'Toyota', Model: 'Corolla', Badge: 'Ascent Sport', Series: 'MZEA12R',
  'Model Year': 2021, Colour: 'Glacier White', Odometer: 45000, Body: 'Hatch',
  Engine: '2.0 litre, 4-Cylinder', 'Fuel Type': 'Petrol', Transmission: 'CVT Automatic',
  'Drive Type': 'Front Wheel Drive', Doors: 5, Seats: 5, Trim: 'Cloth', VIN: 'TEST00000000000',
  'Stock Number': 'TEST001',
};

const details = AUTOMOTIVE_SPEC_LABELS.map((spec) => {
  const row: Record<string, unknown> = { _key: randKey(), _type: 'detail', label: spec.label, valueType: spec.valueType, ...(spec.unit ? { unit: spec.unit } : {}) };
  const raw = made[spec.label];
  if (raw == null) return row;
  if (spec.valueType === 'number') { row.valueNumber = Number(raw); row.value = spec.unit ? Number(raw).toLocaleString('en-AU') : String(raw); }
  else row.value = String(raw);
  return row;
});

const doc = {
  _id: 'test-listing-manual-001',
  _type: 'listing',
  title: 'TEST — 2021 Toyota Corolla Ascent Sport (manual write test)',
  slug: { _type: 'slug', current: 'test-listing-manual-001' },
  description: [],
  price: 24990,
  currency: 'AUD',
  status: 'active' as const,
  category: 'automotive',
  images: [{ _key: randKey(), _type: 'image', asset: { _type: 'reference', _ref: IMAGE_REF } }],
  details,
  vehicleSpecs: { ...specsFromDetails(details), condition: 'used' },
  listingDate: new Date().toISOString(),
};

const res = await client.createOrReplace(doc);
console.log('WROTE:', res._id, '| rev', (res as any)._rev);
// Read back independently to confirm it persisted
const back = await client.fetch('*[_id==$id][0]{_id,title,category,price,"images":count(images),vehicleSpecs}', { id: doc._id });
console.log('READBACK:', JSON.stringify(back, null, 2));
const total = await client.fetch('count(*[_type=="listing"])');
console.log('TOTAL listings now:', total);
