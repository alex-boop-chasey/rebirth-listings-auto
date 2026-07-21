import 'dotenv/config';
import { createClient } from '@sanity/client';
const projectId = process.env.PUBLIC_SANITY_PROJECT_ID!;
const token = process.env.SANITY_TOKEN!;
const apiVersion = process.env.PUBLIC_SANITY_API_VERSION ?? '2024-01-01';
// List all datasets in the project (read-only), then count listings in each.
const base = createClient({ projectId, dataset: 'production', apiVersion, token, useCdn: false });
const datasets: Array<{name:string}> = await base.datasets.list();
console.log('=== datasets in project', projectId, '===');
for (const d of datasets) {
  const c = createClient({ projectId, dataset: d.name, apiVersion, token, useCdn: false });
  const total = await c.fetch('count(*[_type=="listing"])');
  const auto = await c.fetch('count(*[_type=="listing" && category=="automotive"])');
  const sampleNew = await c.fetch('count(*[_type=="listing" && _id match "import-bundaberg-*" && !(_id in ["import-bundaberg-517075","import-bundaberg-517446","import-bundaberg-517627","import-bundaberg-517630","import-bundaberg-517981","import-bundaberg-517991"])])');
  console.log(`  dataset "${d.name}": listings=${total}  automotive=${auto}  new-import-style-ids=${sampleNew}`);
}
