/**
 * scripts/import-bundaberg.ts
 *
 * DEMO-ONLY TOOLING — not shipped in the publishable `astro-listings` package.
 *
 * Imports a curated set of real vehicles from the client's existing dealer site
 * into Sanity, replacing the current automotive listings with real inventory.
 * The user has explicit authorization to reuse this content (it is the client's
 * own site, which this project replaces).
 *
 * The set to import is a committed manifest — `scripts/data/bundaberg-40.json` —
 * that lists each vehicle by detail-page slug plus its source section
 * (new/used/demo), chosen to spread widely across every filterable spec
 * dimension. Edit that file (not this script) to change which vehicles import.
 *
 *   Source:  https://bundabergmotorgroup.com.au
 *
 * Each vehicle's detail page exposes a JSON-LD `Vehicle`/`Product` graph plus a
 * `<span class="val <Label> ">…</span>` spec table; we use JSON-LD as the
 * primary source and the spec table for the human-formatted fields. `condition`
 * is taken from the manifest (the source section), not scraped, so it is
 * deterministic.
 *
 * Usage:
 *   npm run import:bundaberg -- --dry-run   # fetch + print assembled docs, no writes
 *   npm run import:bundaberg                # upload images + commit one transaction
 *
 * Requires a write-enabled SANITY_API_TOKEN in .env.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@sanity/client';
import { randomUUID } from 'node:crypto';
import { AUTOMOTIVE_SPEC_LABELS } from '../src/sanity/templates/automotive';
import { specsFromDetails } from './lib/vehicle-specs';

const MANIFEST_URL = new URL('./data/bundaberg-40.json', import.meta.url);
const ORIGIN = 'https://bundabergmotorgroup.com.au';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MAX_IMAGES = 6;
const IMAGE_DELAY_MS = 250;

const projectId = process.env.PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.PUBLIC_SANITY_DATASET;
const apiVersion = process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01';
const token = process.env.SANITY_TOKEN;

if (!projectId || !dataset || !token) {
  throw new Error(
    'Missing required env vars. Ensure PUBLIC_SANITY_PROJECT_ID, PUBLIC_SANITY_DATASET, ' +
      'and a write-enabled SANITY_API_TOKEN are set in .env.',
  );
}

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });

const dryRun = process.argv.includes('--dry-run');
// --add skips the clean-slate REPLACE: existing automotive listings are kept and
// the manifest vehicles are created alongside them (they use fresh _ids, so
// nothing existing is overwritten). Default (no flag) is REPLACE.
const addOnly = process.argv.includes('--add');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Helpers -----------------------------------------------------------------

/** Random 12-char key for array items without a natural slug (e.g. images). */
const randKey = () => randomUUID().replace(/-/g, '').slice(0, 12);

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Detail `_key` in the template style: label slug + short random suffix. */
const detailKey = (label: string) => `${slugify(label)}-${Math.random().toString(36).slice(2, 8)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "03/2026" (MM/YYYY) -> { iso: "2026-03-01", display: "Mar 2026" }. */
function parseMonthYear(s: string): { iso: string; display: string } | null {
  const m = String(s).match(/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const monthIdx = parseInt(m[1], 10) - 1;
  return { iso: `${m[2]}-${mm}-01`, display: `${MONTHS[monthIdx] ?? m[1]} ${m[2]}` };
}

/** First integer found in a string ("15 km" -> 15, "5-Door" -> 5). */
function firstInt(s: unknown): number | undefined {
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Normalise a source string; junk placeholders ("(No Series)", "N/A") -> undefined. */
function clean(v?: string): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  if (!t) return undefined;
  if (/^\(?\s*(no series|not specified|n\/?a|tba|unknown)\s*\)?$/i.test(t)) return undefined;
  if (/^[-—–]+$/.test(t)) return undefined;
  return t;
}

/** Human-readable engine string from JSON-LD when the spec table is absent. */
function engineFromJsonLd(v: any): string | undefined {
  const e = v?.vehicleEngine;
  if (!e) return undefined;
  const parts: string[] = [];
  if (e.engineDisplacement?.value) parts.push(`${e.engineDisplacement.value} litre`);
  if (e.cylinder) parts.push(`${e.cylinder}-Cylinder`);
  return parts.length ? parts.join(', ') : undefined;
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// --- Source extraction -------------------------------------------------------

type Condition = 'new' | 'used' | 'demo';

interface ManifestEntry {
  slug: string;
  condition: Condition;
  /** Index-card make/model, used as a title fallback when a detail page (e.g. a
   *  POA pre-order) strips make/model from its JSON-LD and spec table. */
  make?: string;
  model?: string;
  label?: string;
}

/** Read + validate the curated import manifest. */
function loadManifest(): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  const vehicles = raw?.vehicles;
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    throw new Error(`Manifest ${MANIFEST_URL.pathname} has no vehicles[]`);
  }
  const valid: Condition[] = ['new', 'used', 'demo'];
  for (const v of vehicles) {
    if (!v?.slug || !valid.includes(v?.condition)) {
      throw new Error(`Manifest entry invalid (needs slug + condition new|used|demo): ${JSON.stringify(v)}`);
    }
  }
  return vehicles as ManifestEntry[];
}

interface SourceVehicle {
  url: string;
  condition: Condition;
  make?: string;
  model?: string;
  badge?: string;
  series?: string;
  modelYear?: number;
  colour?: string;
  odometerKm?: number;
  body?: string;
  engine?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  doors?: number;
  seats?: number;
  trim?: string;
  vin?: string;
  buildDate?: string; // MM/YYYY as displayed on source
  complianceDate?: string;
  stockNumber?: string;
  price: number;
  poa: boolean;
  imageUrls: string[];
}

/** Parse the `<span class="val <Label> ">value</span>` spec table. */
function extractSpecTable(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<span class="val ([^"]*?)\s*">([\s\S]*?)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const label = m[1].trim();
    const value = stripTags(m[2]);
    if (label && value && !(label in out)) out[label] = value;
  }
  return out;
}

/** The JSON-LD `Vehicle` and `Product` nodes from the @graph. */
function extractJsonLd(html: string): { vehicle: any; product: any } {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  let vehicle: any = null;
  let product: any = null;
  for (const b of blocks) {
    let parsed: any;
    try {
      parsed = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] ?? [parsed]);
    for (const n of nodes) {
      const t = n?.['@type'];
      const types = Array.isArray(t) ? t : [t];
      if (types.includes('Vehicle') && !vehicle) vehicle = n;
      if (types.includes('Product') && !product) product = n;
    }
  }
  return { vehicle, product };
}

function driveTypeFromSchema(url?: string): string | undefined {
  if (!url) return undefined;
  const map: Record<string, string> = {
    FrontWheelDriveConfiguration: 'Front Wheel Drive',
    RearWheelDriveConfiguration: 'Rear Wheel Drive',
    AllWheelDriveConfiguration: 'All Wheel Drive',
    FourWheelDriveConfiguration: 'Four Wheel Drive',
  };
  const key = url.split('/').pop() ?? '';
  return map[key];
}

async function extractVehicle(url: string, entry: ManifestEntry): Promise<SourceVehicle> {
  const { condition } = entry;
  const html = await fetchText(url);
  const spec = extractSpecTable(html);
  const { vehicle: v, product: p } = extractJsonLd(html);

  // Prefer the human-formatted spec-table strings for text fields; fall back to
  // JSON-LD. Prefer JSON-LD clean numbers for numeric fields.
  const priceRaw = v?.offers?.[0]?.price ?? p?.offers?.[0]?.price;
  const price = priceRaw != null ? Math.round(parseFloat(String(priceRaw))) : 0;

  // Images: JSON-LD primary (ordered originals), DOM gallery fallback.
  let imageUrls: string[] = Array.isArray(v?.image) ? v.image : Array.isArray(p?.image) ? p.image : [];
  if (imageUrls.length === 0) {
    const ids: string[] = [];
    for (const m of html.matchAll(/resource\.digitaldealer\.com\.au\/image\/([0-9a-f]+)_/gi)) {
      if (!ids.includes(m[1])) ids.push(m[1]);
    }
    imageUrls = ids.map((id) => `https://resource.digitaldealer.com.au/image/${id}_0_0.jpg`);
  }
  imageUrls = imageUrls.slice(0, MAX_IMAGES);

  return {
    url,
    condition,
    // Prefer on-page data; fall back to the manifest's index-card values for
    // pages (e.g. POA pre-orders) that omit make/model from JSON-LD + spec table.
    make: clean(v?.brand?.name) ?? clean(spec['Make']) ?? clean(entry.make),
    model: clean(v?.model) ?? clean(spec['Model']) ?? clean(entry.model),
    badge: clean(spec['Badge']) ?? clean(v?.vehicleConfiguration),
    series: clean(spec['Series']),
    modelYear: firstInt(v?.vehicleModelDate) ?? firstInt(spec['MY'] ? `20${spec['MY']}` : undefined),
    colour: clean(spec['Colour']) ?? clean(v?.color),
    odometerKm: firstInt(v?.mileageFromOdometer?.value) ?? firstInt(spec['Odometer']),
    body: clean(spec['Body']) ?? clean(v?.bodyType),
    engine: clean(spec['Engine']) ?? engineFromJsonLd(v),
    fuelType: clean(spec['Fuel Type']) ?? clean(v?.fuelType),
    transmission: clean(spec['Transmission']) ?? clean(v?.vehicleTransmission),
    driveType: clean(spec['Drive Type']) ?? driveTypeFromSchema(v?.driveWheelConfiguration),
    doors: firstInt(v?.numberOfDoors) ?? firstInt(spec['Doors']),
    seats: firstInt(v?.vehicleSeatingCapacity) ?? firstInt(spec['Seats']),
    trim: clean(spec['Trim']),
    vin: clean(v?.vehicleIdentificationNumber) ?? clean(spec['VIN']),
    buildDate: clean(spec['Build Date']),
    complianceDate: clean(spec['Compliance Date']),
    stockNumber: clean(p?.sku) ?? clean(spec['Stock Number']),
    price,
    poa: price === 0,
    imageUrls,
  };
}

// --- Document assembly -------------------------------------------------------

function buildTitle(s: SourceVehicle): string {
  return [s.modelYear, s.make, s.model, s.badge, s.series].filter(Boolean).join(' ').trim();
}

/** Map each vocabulary label to its raw source value (undefined = empty row). */
function sourceByLabel(s: SourceVehicle): Record<string, string | number | undefined> {
  return {
    Make: s.make,
    Model: s.model,
    Badge: s.badge,
    Series: s.series,
    'Model Year': s.modelYear,
    Colour: s.colour,
    Odometer: s.odometerKm,
    Body: s.body,
    Engine: s.engine,
    'Fuel Type': s.fuelType,
    Transmission: s.transmission,
    'Drive Type': s.driveType,
    Doors: s.doors,
    Seats: s.seats,
    Trim: s.trim,
    VIN: s.vin,
    'Registration Plate': undefined, // new vehicles — unregistered
    'Registration Expiry': undefined,
    'Build Date': s.buildDate,
    'Compliance Date': s.complianceDate,
    'Stock Number': s.stockNumber,
  };
}

/** Build the `details` array by iterating the canonical vocabulary in order. */
function buildDetails(s: SourceVehicle) {
  const byLabel = sourceByLabel(s);
  return AUTOMOTIVE_SPEC_LABELS.map((spec) => {
    const row: Record<string, unknown> = {
      _key: detailKey(spec.label),
      _type: 'detail',
      label: spec.label,
      valueType: spec.valueType,
      ...(spec.unit ? { unit: spec.unit } : {}),
    };
    const raw = byLabel[spec.label];
    if (raw == null || raw === '') return row; // empty row — keep for column alignment

    if (spec.valueType === 'number') {
      const n = typeof raw === 'number' ? raw : firstInt(raw);
      if (n != null) {
        row.valueNumber = n;
        // Mirror to a display string; unit-less numbers must stay separator-free
        // (e.g. "2026", not "2,026") because detailDisplay() reads `value` then.
        row.value = spec.unit ? n.toLocaleString('en-AU') : String(n);
      }
    } else if (spec.valueType === 'date') {
      const d = parseMonthYear(String(raw));
      if (d) {
        row.valueDate = d.iso;
        // detailDisplay() renders dates from `value`, so mirror a readable form.
        row.value = d.display;
      }
    } else {
      // text
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

function buildListingDoc(s: SourceVehicle, images: ImageRef[], onWarn?: (m: string) => void) {
  const title = buildTitle(s);
  // Append the stock number so listings with identical titles (common for new
  // stock of the same variant) get unique, collision-free slugs.
  const base = slugify(title);
  const suffix = s.stockNumber ? `-${s.stockNumber}` : '';
  const slug = `${base.slice(0, 96 - suffix.length).replace(/-+$/g, '')}${suffix}`;
  const id = `import-bundaberg-${s.stockNumber ?? base}`;
  const details = buildDetails(s);
  return {
    _id: id,
    _type: 'listing',
    title,
    slug: { _type: 'slug', current: slug },
    description: [], // intentionally empty — next feature generates AI descriptions
    price: s.price,
    currency: 'AUD',
    status: 'active',
    category: 'automotive',
    images,
    details,
    // Typed spec fields derived from the same rows, via the shared mapper.
    // `condition` is not in details[] (no such source label) — it comes from the
    // manifest's source section and is set deterministically here.
    vehicleSpecs: { ...specsFromDetails(details, { onWarn }), condition: s.condition },
    listingDate: new Date().toISOString(),
  };
}

// --- Images ------------------------------------------------------------------

async function uploadImages(s: SourceVehicle, title: string): Promise<ImageRef[]> {
  const refs: ImageRef[] = [];
  for (let i = 0; i < s.imageUrls.length; i++) {
    const url = s.imageUrls[i];
    const res = await fetch(url, { headers: { 'user-agent': UA, referer: s.url } });
    if (!res.ok) {
      console.warn(`  ! image ${i + 1} failed (${res.status}) for ${title}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = `${slugify(title)}-${i + 1}.jpg`;
    const asset = await client.assets.upload('image', buffer, { filename });
    refs.push({ _key: randKey(), _type: 'image', asset: { _type: 'reference', _ref: asset._id } });
    if (i < s.imageUrls.length - 1) await sleep(IMAGE_DELAY_MS);
  }
  return refs;
}

/** GET the first image to confirm it's fetchable (referer-gated host). */
async function firstImageOk(s: SourceVehicle): Promise<boolean> {
  if (!s.imageUrls.length) return false;
  try {
    const r = await fetch(s.imageUrls[0], { headers: { 'user-agent': UA, referer: s.url } });
    return r.ok;
  } catch {
    return false;
  }
}

/** Compact distribution of a vehicleSpecs field across all docs, for review. */
function distribution(docs: any[], field: string): string {
  const m: Record<string, number> = {};
  for (const d of docs) {
    const v = d.vehicleSpecs?.[field];
    const k = v == null ? '(none)' : String(v);
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`)
    .join(', ');
}

// --- Main --------------------------------------------------------------------

async function main() {
  const manifest = loadManifest();
  console.log(`\nSource: ${ORIGIN}  (manifest: ${manifest.length} vehicles)`);
  console.log(dryRun ? '*** DRY RUN — no writes ***\n' : '*** LIVE IMPORT ***\n');

  // Warnings collected from the shared spec-mapper, tagged with their vehicle.
  const warnings: string[] = [];

  const sources: SourceVehicle[] = [];
  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    const url = `${ORIGIN}/${entry.slug}/`;
    const s = await extractVehicle(url, entry);
    sources.push(s);
    if (i === 0) {
      // Print vehicle #1 in full first, so a bad extraction pattern is caught early.
      console.log('===== Extracted vehicle #1 (inspect before the rest) =====');
      console.log(JSON.stringify({ ...s, imageUrls: `${s.imageUrls.length} urls` }, null, 2));
      console.log(JSON.stringify(buildListingDoc(s, []), null, 2));
      console.log('==========================================================\n');
    }
    await sleep(IMAGE_DELAY_MS);
  }

  // Assemble docs (dry-run: no image refs). Capture per-vehicle mapper warnings.
  const assembled = sources.map((s) => {
    const title = buildTitle(s);
    const doc = buildListingDoc(s, [], (m) => warnings.push(`${title}: ${m}`));
    return { s, title, doc };
  });

  // --- Report signals -------------------------------------------------------
  const emptyAcrossAll = AUTOMOTIVE_SPEC_LABELS.filter((spec) =>
    assembled.every(({ doc }) => {
      const row = doc.details.find((d: any) => d.label === spec.label) as any;
      return row && row.value == null && row.valueNumber == null && row.valueDate == null && row.valueBoolean == null;
    }),
  ).map((s) => s.label);

  console.log('===== Assembled listings =====');
  for (const { s, title, doc } of assembled) {
    const filled = (doc.details as any[]).filter(
      (d) => d.value != null || d.valueNumber != null || d.valueDate != null || d.valueBoolean != null,
    ).length;
    console.log(
      `  • [${s.condition}] ${title}  [stock ${s.stockNumber ?? '—'}]  $${s.price.toLocaleString('en-AU')}${
        s.poa ? ' (POA!)' : ''
      }  images:${s.imageUrls.length}  detailsFilled:${filled}/${AUTOMOTIVE_SPEC_LABELS.length}`,
    );
  }

  const specFields = ['bodyType', 'fuelType', 'transmission', 'driveType', 'seatCount', 'condition'];

  if (dryRun) {
    // Re-verify every vehicle's first image is fetchable, so image-less stock is
    // caught before the write rather than rendering a fallback icon.
    console.log('\nVerifying images…');
    const imageless: string[] = [];
    for (const { s, title } of assembled) {
      if (!(await firstImageOk(s))) imageless.push(`${title} (${s.url})`);
      await sleep(80);
    }

    console.log('\n===== DRY RUN REPORT =====');
    console.log(`Listings assembled: ${assembled.length}`);
    console.log(`Total images (to upload): ${sources.reduce((n, s) => n + s.imageUrls.length, 0)}`);
    console.log(`Rows empty across ALL ${assembled.length}: ${emptyAcrossAll.length ? emptyAcrossAll.join(', ') : '(none)'}`);
    const poa = assembled.filter(({ s }) => s.poa).map(({ title }) => title);
    console.log(`POA / price-missing (${poa.length}): ${poa.length ? poa.join('; ') : '(none)'}`);

    console.log('\n--- vehicleSpecs distribution (preview) ---');
    for (const f of specFields) console.log(`  ${f}: ${distribution(assembled.map((a) => a.doc), f)}`);

    console.log(`\n--- Mapper WARNs (${warnings.length}) ---`);
    if (warnings.length) warnings.forEach((w) => console.log(`  WARN ${w}`));
    else console.log('  (none)');

    console.log(`\n--- Image check ---`);
    console.log(
      imageless.length
        ? `  ⚠ ${imageless.length} vehicle(s) with NO fetchable first image — DROP these before commit:\n    ${imageless.join('\n    ')}`
        : '  ✓ all vehicles have a fetchable first image',
    );

    // Show the exact deletion set the live run would perform, for review.
    const importIds = assembled.map((a) => a.doc._id);
    if (addOnly) {
      console.log('\n--- ADD mode: no existing listings will be deleted ---');
    } else {
      const toDelete: string[] = await client.fetch(
        '*[_type == "listing" && category == "automotive" && !(_id in $ids)]._id',
        { ids: importIds },
      );
      console.log(`\n--- REPLACE plan: would delete ${toDelete.length} existing automotive listing(s) by explicit _id ---`);
      toDelete.forEach((id) => console.log(`  ✗ delete ${id}`));
    }

    console.log('\nDry run complete — no documents or assets were written.');
    return;
  }

  // --- Live import ----------------------------------------------------------
  // 1. Upload image assets first (outside the transaction).
  const docs: any[] = [];
  let totalImages = 0;
  for (const { s, title } of assembled) {
    console.log(`Uploading ${s.imageUrls.length} image(s) for "${title}"…`);
    const refs = await uploadImages(s, title);
    totalImages += refs.length;
    docs.push(buildListingDoc(s, refs));
  }

  // 2. Which automotive docs to delete: existing autos that aren't one of ours.
  //    Deletion is performed by explicit _id below (never a broad query-match).
  //    In --add mode we delete nothing.
  const importIds = docs.map((d) => d._id);
  const toDelete: string[] = addOnly
    ? []
    : await client.fetch(
        '*[_type == "listing" && category == "automotive" && !(_id in $ids)]._id',
        { ids: importIds },
      );

  // 3. One transaction: deletes (if any) + createOrReplace → webhook fires once.
  const tx = client.transaction();
  toDelete.forEach((id) => tx.delete(id));
  docs.forEach((d) => tx.createOrReplace(d));
  await tx.commit();

  console.log('\n===== IMPORT REPORT =====');
  console.log(`Mode: ${addOnly ? 'ADD (no deletions)' : 'REPLACE'}`);
  console.log(`Deleted automotive listings (${toDelete.length}): ${toDelete.join(', ') || '(none)'}`);
  docs.forEach((d) => console.log(`  ✓ created ${d.title}  [stock ${d._id.replace('import-bundaberg-', '')}]`));
  console.log(`Total images uploaded: ${totalImages}`);
  console.log(`Rows empty across ALL ${assembled.length}: ${emptyAcrossAll.length ? emptyAcrossAll.join(', ') : '(none)'}`);
  console.log('\n--- vehicleSpecs distribution ---');
  for (const f of specFields) console.log(`  ${f}: ${distribution(docs, f)}`);
  console.log(`\nMapper WARNs (${warnings.length}): ${warnings.length ? '' : '(none)'}`);
  warnings.forEach((w) => console.log(`  WARN ${w}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
