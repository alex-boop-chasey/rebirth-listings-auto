const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const stripTags=s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
for(const slug of ['517696-1872022-kia-carnival-2026','517697-1869772-kia-picanto-2026']){
  const h=await get(`https://bundabergmotorgroup.com.au/${slug}/`);
  const sp={};for(const m of h.matchAll(/<span class="val ([^"]*?)\s*">([\s\S]*?)<\/span>/gi)){const l=m[1].trim();if(l&&!(l in sp))sp[l]=stripTags(m[2]);}
  // JSON-LD brand/model
  let brand,model;
  for(const m of h.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)){try{const p=JSON.parse(m[1].trim());const nodes=Array.isArray(p)?p:(p['@graph']??[p]);for(const n of nodes){const t=[].concat(n?.['@type']);if(t.includes('Vehicle')){brand=n?.brand?.name;model=n?.model;}}}catch{}}
  console.log('\n=== '+slug+' ===');
  console.log('JSON-LD brand:',JSON.stringify(brand),'model:',JSON.stringify(model));
  console.log('spec Make:',JSON.stringify(sp['Make']),'| spec Model:',JSON.stringify(sp['Model']),'| Badge:',JSON.stringify(sp['Badge']),'| Series:',JSON.stringify(sp['Series']));
}
