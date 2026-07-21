import fs from 'node:fs';
const m=JSON.parse(fs.readFileSync('scripts/_tmp-manifest.json','utf8'));
const out={
  _comment:'DEMO-ONLY. Curated 40-vehicle import set from bundabergmotorgroup.com.au, selected in ticket "populate 40 real vehicles" to maximise spread across every filterable spec dimension. `condition` is the source section (new/used/demo-vehicles), used to populate vehicleSpecs.condition deterministically. `label` is human-readable for review only. Regenerate by re-running the selection; edit by hand to add/drop a vehicle by slug.',
  source:'https://bundabergmotorgroup.com.au',
  vehicles:m.map(v=>({slug:v.slug,condition:v.condition,label:v.label})),
};
fs.writeFileSync('scripts/data/bundaberg-40.json',JSON.stringify(out,null,2)+'\n');
console.log('wrote scripts/data/bundaberg-40.json with',out.vehicles.length,'vehicles');
