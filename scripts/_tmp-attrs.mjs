const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const h=await get('https://bundabergmotorgroup.com.au/used-vehicles/');
// all distinct data-stock* attribute NAMES
const names=new Set();
for(const m of h.matchAll(/data-stock[a-z]+/gi)) names.add(m[0].toLowerCase());
console.log('data-stock attrs:',[...names].join(', '));
// spec spans in list view (fuel, transmission, odo, seats?)
const specNames=new Set();
for(const m of h.matchAll(/class="[^"]*\bval\s+([A-Za-z ]+?)\s*"/g)) specNames.add(m[1].trim());
console.log('val-span labels:',[...specNames].join(' | '));
// look for icon-spec list items like <li ...>Petrol</li> patterns / si-spec
for(const m of h.matchAll(/si-[a-z-]*spec[a-z-]*/gi)) {console.log('specClass:',m[0]); break;}
// dump one full card list-view spec block
const idx=h.indexOf('data-stockmodel="Tiggo 8 Pro Max"');
console.log('--- listview specs sample ---');
console.log(h.slice(idx+1200, idx+2600).replace(/<img[^>]*>/g,'').replace(/\s+/g,' '));
