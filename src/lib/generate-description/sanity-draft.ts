/**
 * Server-side fetch of a listing DRAFT for the description generator.
 *
 * Uses a token-authed @sanity/client with `useCdn: false` and the `raw`
 * perspective so unpublished draft edits are visible (the button runs before the
 * dealer publishes). This is deliberately distinct from the public client
 * (src/sanity/lib/client.ts), which carries no token and uses the CDN. Project/
 * dataset come from the PUBLIC_SANITY_* build vars (inlined into the Worker
 * bundle); the token comes from the Worker runtime env (see ./env.ts).
 */
import { createClient } from '@sanity/client';

export interface DraftListing {
  _id: string;
  title?: string;
  category?: string;
  vehicleSpecs?: Record<string, unknown>;
  dealerNotes?: string;
  /** Image members with their asset reference — used to build CDN URLs for vision. */
  images?: Array<{ asset?: { _ref?: string } }>;
}

const PROJECTION = `{
  _id, title, category,
  vehicleSpecs{ bodyType, transmission, fuelType, driveType, seatCount, year, odometer, condition },
  dealerNotes, images[]{ asset }
}`;

/**
 * Fetch the draft (preferred) or published listing by id. Accepts an id with or
 * without the `drafts.` prefix; queries both and prefers the draft when present.
 * Returns null when neither exists.
 */
export async function fetchDraftListing(token: string, listingId: string): Promise<DraftListing | null> {
  const client = createClient({
    projectId: import.meta.env.PUBLIC_SANITY_PROJECT_ID,
    dataset: import.meta.env.PUBLIC_SANITY_DATASET,
    apiVersion: import.meta.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01',
    useCdn: false,
    token,
    perspective: 'raw',
  });

  const publishedId = listingId.replace(/^drafts\./, '');
  const draftId = `drafts.${publishedId}`;
  const query = `*[_type == "listing" && _id in [$draftId, $publishedId]]${PROJECTION}`;
  const docs = await client.fetch<DraftListing[]>(query, { draftId, publishedId });
  if (!docs?.length) return null;
  return docs.find((d) => d._id === draftId) ?? docs[0];
}
