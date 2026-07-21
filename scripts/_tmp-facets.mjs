const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const h=await get('https://bundabergmotorgroup.com.au/new-demo-used-vehicles/');
// Filter facet links usually carry ?fueltype= / ?transmission= / ?bodytype= etc with a count nearby
const params=new Set();
for(const m of h.matchAll(/[?&]([a-zA-Z]+)=[^"&]+/g)) params.add(m[1]);
console.log('QUERY PARAMS SEEN:',[...params].sort().join(', '));
console.log('\n--- fuel/transmission facet links (with surrounding text) ---');
for(const m of h.matchAll(/href="[^"]*(?:fuel|transmission)[^"]*"[^>]*>([\s\S]{0,60}?)</gi)){
  console.log(m[0].replace(/\s+/g,' ').slice(0,140));
}
