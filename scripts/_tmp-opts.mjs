const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const h=await get('https://bundabergmotorgroup.com.au/new-demo-used-vehicles/');
// Find filter groups: look for inputs/labels referencing fuels/gearboxes/seats
for(const key of ['fuels','gearboxes','seats','bodies']){
  console.log('\n===== '+key+' options =====');
  // capture value="..." within a block that also has data-refine or name=key
  const re=new RegExp(`(?:name|data-filter|data-refine|data-group)="?${key}"?[\\s\\S]{0,4000}`,'i');
  const m=h.match(re);
  if(!m){console.log('(group not found by name)');continue;}
  const seg=m[0].slice(0,4000);
  // extract value + adjacent count
  for(const mm of seg.matchAll(/value="([^"]+)"[\s\S]{0,160}?(?:\((\d+)\)|<span[^>]*>\s*(\d+)\s*<)/g)){
    console.log('  ',mm[1].padEnd(20),'count=',mm[2]||mm[3]||'');
  }
}
