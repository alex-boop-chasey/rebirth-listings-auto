/**
 * scripts/migrate-details-to-specs.ts
 *
 * DEMO-ONLY TOOLING — one-shot, idempotent migration that copies filterable
 * values out of the loose `details[]` array into the typed `vehicleSpecs`
 * fields. The `details[]` entries are LEFT IN PLACE (existing display code still
 * reads them); this only fills the new typed fields.
 *
 * Idempotency: a field is only written when its current typed value is
 * null/undefined, so re-running is a no-op once populated.
 *
 * Usage:
 *   tsx scripts/migrate-details-to-specs.ts            # dry-run (default) — prints diff, no writes
 *   tsx scripts/migrate-details-to-specs.ts --commit   # actually write the patches
 *
 * Requires a write-enabled SANITY_API_TOKEN in .env.
 */
import 'dotenv/config';
import { createClient } from '@sanity/client';
import { deriveVehicleSpecs, type VehicleSpecs } from './lib/vehicle-specs';

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

const commit = process.argv.includes('--commit');

interface DetailRow {
  label?: string;
  value?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: string;
  valueType?: string;
}

interface ListingRow {
  _id: string;
  title: string;
  vehicleSpecs?: VehicleSpecs;
  details?: DetailRow[];
}

const QUERY = `*[_type == "listing" && category == "automotive"]{
  _id, title, vehicleSpecs,
  details[]{ label, value, valueNumber, valueBoolean, valueDate, valueType }
}`;

async function migrate() {
  const listings = await client.fetch<ListingRow[]>(QUERY);
  console.log(
    `${commit ? 'COMMIT' : 'DRY-RUN'} — scanning ${listings.length} automotive listing(s).\n`,
  );

  let changedListings = 0;
  let changedFields = 0;

  for (const listing of listings) {
    const existing = listing.vehicleSpecs ?? {};
    const entries = deriveVehicleSpecs(listing.details, {
      onWarn: (m) => console.warn(`  WARN: [${listing.title}] ${m}`),
    });

    // Idempotency: keep only fields not already set on the doc.
    const proposed = entries.filter(
      (e) => existing[e.field] === undefined || existing[e.field] === null,
    );

    if (proposed.length === 0) continue;

    changedListings += 1;
    changedFields += proposed.length;

    console.log(`• ${listing.title}`);
    for (const e of proposed) {
      console.log(`    ${e.field}: ${e.raw} → ${JSON.stringify(e.typed)}`);
    }

    if (commit) {
      const patch: Record<string, string | number> = {};
      for (const e of proposed) patch[`vehicleSpecs.${e.field}`] = e.typed;
      await client.patch(listing._id).set(patch).commit();
    }
  }

  console.log(
    `\n${commit ? 'Committed' : 'Would update'} ${changedFields} field(s) across ${changedListings} listing(s).`,
  );
  if (!commit) console.log('Re-run with --commit to write these changes.');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
