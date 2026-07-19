/**
 * scripts/import-remax.ts
 *
 * DEMO-ONLY TOOLING — not shipped in the publishable `astro-listings` package.
 *
 * Imports the first 6 for-sale listings from RE/MAX Australia into Sanity as
 * real-estate listings (category "real-estate"), following the same shape as
 * scripts/import-bundaberg.ts.
 *
 *   Source:   https://www.remax.com.au/properties-for-sale/  (first 6, in page order)
 *   Captured: 2026-07-20
 *
 * NOTE ON CONTENT: unlike the Bundaberg import (the client's own site), these are
 * THIRD-PARTY listings — the photos and copy belong to RE/MAX and the listing
 * agents. Treat them strictly as demo placeholder content; do not ship them on a
 * public production site. Swap for owned/licensed content before going live.
 *
 * The RE/MAX index grid is AJAX-rendered, so the per-listing fields below were
 * captured from the rendered detail pages (address, price, bed/bath/car, land
 * size, property type, gallery originals). Images are fetched at import time from
 * the property media CDN and uploaded as Sanity assets.
 *
 * Usage:
 *   npm run import:remax -- --dry-run   # print assembled docs, no writes
 *   npm run import:remax                # upload images + commit one transaction
 *
 * Requires a write-enabled SANITY_API_TOKEN in .env. This is ADDITIVE — it does
 * not delete existing real-estate listings (unlike import-bundaberg, which
 * replaced the automotive seeds).
 */
import 'dotenv/config';
import { createClient } from '@sanity/client';
import { randomUUID } from 'node:crypto';
import { REAL_ESTATE_SPEC_LABELS } from '../src/sanity/templates/realEstate';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const IMAGE_DELAY_MS = 250;

const projectId = process.env.PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.PUBLIC_SANITY_DATASET;
const apiVersion = process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01';
const token = process.env.SANITY_API_TOKEN;

if (!projectId || !dataset || !token) {
  throw new Error(
    'Missing required env vars. Ensure PUBLIC_SANITY_PROJECT_ID, PUBLIC_SANITY_DATASET, ' +
      'and a write-enabled SANITY_API_TOKEN are set in .env.',
  );
}

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });
const dryRun = process.argv.includes('--dry-run');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Source data (captured from remax.com.au, 2026-07-20) ---------------------

interface SourceListing {
  url: string;
  title: string; // full address
  propertyType: string; // display label
  price: number; // 0 = price on application (RE/MAX shows a phrase, not a number)
  priceDisplay: string; // the phrase RE/MAX showed, for reference/reporting
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSize?: number; // sqm
  description: string; // marketing headline
  images: string[]; // gallery originals, in order
}

const IMG = (stem: string, ext = 'jpg') =>
  `https://propertyimages.stepps.net/398-remax/o/${stem}.${ext}`;

const SOURCE_LISTINGS: SourceListing[] = [
  {
    url: 'https://www.remax.com.au/property/house-qld-surfers-paradise-21653714/',
    title: '503/12-16 Weemala Street Surfers Paradise QLD 4217',
    propertyType: 'House',
    price: 0,
    priceDisplay: 'Best offer on or before TBA',
    bedrooms: 2,
    bathrooms: 2,
    carSpaces: 1,
    landSize: 550,
    description: 'UNDER INSTRUCTION TO LIQUIDATE: Your Golden Ticket to Orama on Chevron Island.',
    images: [
      IMG('484-residential-21653714-avg4s'),
      IMG('484-residential-21653714-vipggy'),
      IMG('484-residential-21653714-yrbnpy'),
      IMG('484-residential-21653714-e18x4f'),
      IMG('484-residential-21653714-gukxxu'),
    ],
  },
  {
    url: 'https://www.remax.com.au/property/acreagesemi-rural-qld-deuchar-r2-5181198/',
    title: '33 Hendon Deuchar Road Deuchar QLD 4362',
    propertyType: 'Acreage / Semi-Rural',
    price: 995000,
    priceDisplay: 'Offers over $995,000',
    bedrooms: 3,
    bathrooms: 2,
    carSpaces: 5,
    landSize: 80000,
    description: 'Country Living with Space, Comfort & Versatility on 8ha / 19.8 acres.',
    images: [
      IMG('465-residential-r2-5181198-bqi72e'),
      IMG('465-residential-r2-5181198-s03t3n'),
      IMG('465-residential-r2-5181198-a2dy8z'),
      IMG('465-residential-r2-5181198-xwyir'),
      IMG('465-residential-r2-5181198-mmnot'),
    ],
  },
  {
    url: 'https://www.remax.com.au/property/house-qld-logan-reserve-l37604754/',
    title: '118 Pierro Place Logan Reserve QLD 4133',
    propertyType: 'House',
    price: 0,
    priceDisplay: 'All Offers Invited!',
    bedrooms: 6,
    bathrooms: 3,
    carSpaces: 2,
    landSize: 523,
    description: 'East Facing | Just 3 Years Young — Dual-Key Investment or Family Haven!',
    images: [
      IMG('669-residential-l37604754-xbcos', 'png'),
      IMG('669-residential-l37604754-ssg8y', 'png'),
      IMG('669-residential-l37604754-p2hore', 'png'),
      IMG('669-residential-l37604754-zrurrn', 'png'),
      IMG('669-residential-l37604754-bsvn0i', 'png'),
    ],
  },
  {
    url: 'https://www.remax.com.au/property/house-qld-holmview-l35220979/',
    title: '46 Clermont Street Holmview QLD 4207',
    propertyType: 'House',
    price: 0,
    priceDisplay: 'Just Listed & Must Be Sold',
    bedrooms: 4,
    bathrooms: 2,
    carSpaces: 2,
    description: 'Great Investment or Perfect First Home, Move-In Ready in Holmview.',
    images: [
      IMG('479-residential-l35220979-cryzir'),
      IMG('479-residential-l35220979-mwbfu'),
      IMG('479-residential-l35220979-kpk9ak'),
      IMG('479-residential-l35220979-qq2eu'),
      IMG('479-residential-l35220979-e1oymw'),
    ],
  },
  {
    url: 'https://www.remax.com.au/property/house-qld-wynnum-l27621422/',
    title: '22 Meilandt Street Wynnum QLD 4178',
    propertyType: 'House',
    price: 0,
    priceDisplay: 'For Sale',
    bedrooms: 3,
    bathrooms: 1,
    carSpaces: 4,
    description: 'Freshly Updated Family Home in a Prime Bayside Location.',
    images: [
      IMG('455-residential-l27621422-xiknw'),
      IMG('455-residential-l27621422-nsxf7c'),
      IMG('455-residential-l27621422-x2dlzf'),
      IMG('455-residential-l27621422-aoodnn'),
      IMG('455-residential-l27621422-j3jreu'),
    ],
  },
  {
    url: 'https://www.remax.com.au/property/house-qld-tiaro-l41648210/',
    title: '17 Walter Street Tiaro QLD 4650',
    propertyType: 'House',
    price: 0,
    priceDisplay: 'For Sale',
    bedrooms: 2,
    bathrooms: 1,
    carSpaces: 3,
    landSize: 2023,
    // NOTE: RE/MAX publishes only ONE photo for this listing — imports with 1 image, not 5.
    description: 'Country Charm on a Big 2,023m² Block.',
    images: [IMG('663-residential-l41648210-tdtnvu', 'png')],
  },
];

// --- Helpers -----------------------------------------------------------------

const randKey = () => randomUUID().replace(/-/g, '').slice(0, 12);
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const detailKey = (label: string) => `${slugify(label)}-${Math.random().toString(36).slice(2, 8)}`;

/** Last path segment of the listing URL — a stable, unique id token. */
const urlToken = (url: string) => url.split('/').filter(Boolean).pop() ?? slugify(url);

/** One-paragraph portable-text block from the marketing headline. */
function descriptionBlocks(text: string) {
  if (!text) return [];
  return [
    {
      _type: 'block',
      _key: randKey(),
      style: 'normal',
      markDefs: [],
      children: [{ _type: 'span', _key: randKey(), text, marks: [] }],
    },
  ];
}

/** Map each real-estate vocabulary label to this listing's raw value. */
function sourceByLabel(s: SourceListing): Record<string, string | number | undefined> {
  return {
    'Property Type': s.propertyType,
    Bedrooms: s.bedrooms,
    Bathrooms: s.bathrooms,
    'Car Spaces': s.carSpaces,
    'Land Size': s.landSize,
    'Internal Size': undefined,
    'Year Built': undefined,
    'Council Rates': undefined,
    'Has Pool': undefined,
    'Pet Friendly': undefined,
  };
}

/** Build the `details` array by iterating the canonical vocabulary in order. */
function buildDetails(s: SourceListing) {
  const byLabel = sourceByLabel(s);
  return REAL_ESTATE_SPEC_LABELS.map((spec) => {
    const row: Record<string, unknown> = {
      _key: detailKey(spec.label),
      _type: 'detail',
      label: spec.label,
      valueType: spec.valueType,
      ...(spec.unit ? { unit: spec.unit } : {}),
    };
    const raw = byLabel[spec.label];
    if (raw == null || raw === '') return row; // empty row — kept for column alignment

    if (spec.valueType === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
      if (Number.isFinite(n)) {
        row.valueNumber = n;
        // Mirror to a display string; unit-less numbers stay separator-free.
        row.value = spec.unit ? n.toLocaleString('en-AU') : String(n);
      }
    } else {
      row.value = String(raw);
    }
    return row;
  });
}

interface ImageRef {
  _key: string;
  _type: 'image';
  asset: { _type: 'reference'; _ref: string };
}

function buildListingDoc(s: SourceListing, images: ImageRef[]) {
  const token = urlToken(s.url);
  return {
    _id: `import-remax-${token}`,
    _type: 'listing',
    title: s.title,
    slug: { _type: 'slug', current: slugify(s.title).slice(0, 96).replace(/-+$/g, '') },
    description: descriptionBlocks(s.description),
    price: s.price,
    currency: 'AUD',
    status: 'active',
    category: 'real-estate',
    images,
    details: buildDetails(s),
    listingDate: new Date().toISOString(),
  };
}

// --- Images ------------------------------------------------------------------

async function uploadImages(s: SourceListing): Promise<ImageRef[]> {
  const refs: ImageRef[] = [];
  for (let i = 0; i < s.images.length; i++) {
    const url = s.images[i];
    const res = await fetch(url, { headers: { 'user-agent': UA, referer: s.url } });
    if (!res.ok) {
      console.warn(`  ! image ${i + 1} failed (${res.status}) for ${s.title}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = url.endsWith('.png') ? 'png' : 'jpg';
    const filename = `${slugify(s.title)}-${i + 1}.${ext}`;
    const asset = await client.assets.upload('image', buffer, { filename });
    refs.push({ _key: randKey(), _type: 'image', asset: { _type: 'reference', _ref: asset._id } });
    if (i < s.images.length - 1) await sleep(IMAGE_DELAY_MS);
  }
  return refs;
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log('\nSource: https://www.remax.com.au/properties-for-sale/ (first 6)');
  console.log(dryRun ? '*** DRY RUN — no writes ***\n' : '*** LIVE IMPORT (additive) ***\n');

  console.log('===== Assembled listings =====');
  for (const s of SOURCE_LISTINGS) {
    const doc = buildListingDoc(s, []);
    const filled = (doc.details as any[]).filter(
      (d) => d.value != null || d.valueNumber != null,
    ).length;
    console.log(
      `  • ${s.title}\n      ${s.propertyType} · ${s.bedrooms ?? '—'}bd/${s.bathrooms ?? '—'}ba/` +
        `${s.carSpaces ?? '—'}car · land:${s.landSize ?? '—'} · price:${
          s.price ? '$' + s.price.toLocaleString('en-AU') : `0 (${s.priceDisplay})`
        } · images:${s.images.length} · detailsFilled:${filled}/${REAL_ESTATE_SPEC_LABELS.length}`,
    );
  }

  if (dryRun) {
    console.log('\n===== DRY RUN REPORT =====');
    console.log('Full assembled doc for listing #1:');
    console.log(JSON.stringify(buildListingDoc(SOURCE_LISTINGS[0], []), null, 2));
    console.log(`\nListings: ${SOURCE_LISTINGS.length}`);
    console.log(`Total images to upload: ${SOURCE_LISTINGS.reduce((n, s) => n + s.images.length, 0)}`);
    const poa = SOURCE_LISTINGS.filter((s) => !s.price).map((s) => `${s.title} (${s.priceDisplay})`);
    console.log(`Price-on-application (price 0): ${poa.length}\n  - ${poa.join('\n  - ')}`);
    const fewImgs = SOURCE_LISTINGS.filter((s) => s.images.length < 5).map((s) => `${s.title} (${s.images.length})`);
    console.log(`Fewer than 5 images: ${fewImgs.length ? fewImgs.join('; ') : '(none)'}`);
    console.log('\nDry run complete — no documents or assets were written.');
    return;
  }

  // --- Live import ----------------------------------------------------------
  const docs: any[] = [];
  let totalImages = 0;
  for (const s of SOURCE_LISTINGS) {
    console.log(`Uploading ${s.images.length} image(s) for "${s.title}"…`);
    const refs = await uploadImages(s);
    totalImages += refs.length;
    docs.push(buildListingDoc(s, refs));
  }

  // Additive: createOrReplace only (no deletes of existing real-estate).
  const tx = client.transaction();
  docs.forEach((d) => tx.createOrReplace(d));
  await tx.commit();

  console.log('\n===== IMPORT REPORT =====');
  docs.forEach((d) => console.log(`  ✓ ${d.title}  [${d.images.length} img]`));
  console.log(`Total images uploaded: ${totalImages}`);
  console.log('Done. These are third-party demo placeholders — replace before public production use.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
