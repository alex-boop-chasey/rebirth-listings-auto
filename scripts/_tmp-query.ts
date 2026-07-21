import 'dotenv/config';
import { createClient } from '@sanity/client';
const client = createClient({
  projectId: process.env.PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.PUBLIC_SANITY_DATASET!,
  apiVersion: process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01',
  token: process.env.SANITY_TOKEN, useCdn: false,
});
const rows = await client.fetch(`*[_type=="listing"]{_id,title,category,"images":count(images),"specs":vehicleSpecs}|order(_id)`);
console.log('TOTAL listings:', rows.length);
for (const r of rows) console.log(JSON.stringify(r));
