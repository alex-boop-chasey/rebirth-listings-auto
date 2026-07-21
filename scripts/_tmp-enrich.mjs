import fs from 'node:fs';
const man=JSON.parse(fs.readFileSync('scripts/data/bundaberg-40.json','utf8'));
const sel=JSON.parse(fs.readFileSync('scripts/_tmp-final40.json','utf8'));
const bySlug=new Map(sel.map(r=>[r.url,r]));
man.vehicles=man.vehicles.map(v=>{
  const r=bySlug.get(v.slug);
  return {slug:v.slug,condition:v.condition,make:r?.make,model:r?.model,label:v.label};
});
man._comment=man._comment.replace('`label` is human-readable for review only.','`make`/`model` are the index-card values, used as a title fallback when a detail page (e.g. a POA pre-order) omits them from JSON-LD. `label` is human-readable for review only.');
fs.writeFileSync('scripts/data/bundaberg-40.json',JSON.stringify(man,null,2)+'\n');
const missing=man.vehicles.filter(v=>!v.make||!v.model);
console.log('enriched. entries missing make/model:',missing.length, missing.map(v=>v.slug));
