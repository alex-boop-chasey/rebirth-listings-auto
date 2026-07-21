import 'dotenv/config';
import { createClient } from '@sanity/client';
const client = createClient({
  projectId: process.env.PUBLIC_SANITY_PROJECT_ID!, dataset: process.env.PUBLIC_SANITY_DATASET!,
  apiVersion: process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01', token: process.env.SANITY_TOKEN, useCdn: false,
});
const r = await client.fetch(`*[_type=="listing" && count(images)>0][0]{_id,title,"ref":images[0].asset._ref}`);
console.log(JSON.stringify(r));
