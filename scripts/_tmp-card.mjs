const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const h=await get('https://bundabergmotorgroup.com.au/used-vehicles/');
// isolate one stock item block
const i=h.search(/stockItem|listItem|vehicle-card|stock-item/i);
console.log('anchor idx:',i);
// Find first detail-link and print ~1600 chars around a card
const m=h.match(/(\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4})\//);
const idx=h.indexOf(m[0]);
let block=h.slice(idx-1200, idx+1400).replace(/<img[^>]*>/g,'<img>');
console.log('----- RAW CARD REGION -----');
console.log(block);
