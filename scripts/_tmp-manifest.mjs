import fs from 'node:fs';
const inv=JSON.parse(fs.readFileSync('scripts/_tmp-inventory.json','utf8'));
const sel=JSON.parse(fs.readFileSync('scripts/_tmp-final40.json','utf8'));
const catToCond={'new-vehicles':'new','used-vehicles':'used','demo-vehicles':'demo'};
const bySlug=new Map(inv.map(r=>[r.url,r]));
const manifest=[];
const problems=[];
for(const s of sel){
  const r=bySlug.get(s.url);
  if(!r){problems.push('NOT IN INVENTORY: '+s.url);continue;}
  const cond=catToCond[r.cat];
  if(!cond){problems.push('NO SECTION: '+s.url+' cat='+r.cat);continue;}
  manifest.push({slug:r.url,condition:cond,label:`${s.year} ${s.make} ${s.model}`});
}
manifest.sort((a,b)=>a.condition.localeCompare(b.condition)||a.label.localeCompare(b.label));
console.log('manifest entries:',manifest.length);
console.log('problems:',problems.length?problems:'(none)');
const cd={};for(const m of manifest)cd[m.condition]=(cd[m.condition]||0)+1;
console.log('condition from SECTION:',JSON.stringify(cd));
// show the two previously-"?" rows resolved
for(const u of ['517301','i30','dmax-2023']) ;
fs.writeFileSync('scripts/_tmp-manifest.json',JSON.stringify(manifest,null,2));
manifest.forEach((m,i)=>console.log(String(i+1).padStart(2),m.condition.padEnd(5),m.slug.padEnd(42),m.label));
