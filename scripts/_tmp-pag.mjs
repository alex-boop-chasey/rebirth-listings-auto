const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return {status:r.status,html:await r.text()};}
const {html}=await get('https://bundabergmotorgroup.com.au/used-vehicles/');
// context around 'Vehicles' count
for(const m of html.matchAll(/.{40}vehicles.{10}/gi)){const t=m[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');if(/\d/.test(t))console.log('CNT:',t);}
console.log('--- pagination-ish links ---');
const links=new Set();
for(const m of html.matchAll(/href="([^"]*(?:page|paged|offset|p=)[^"]*)"/gi)) links.add(m[1]);
[...links].slice(0,20).forEach(l=>console.log('LINK:',l));
console.log('--- data attributes hinting load-more/ajax ---');
for(const m of html.matchAll(/data-(page|total|count|per-page|url|ajax|load)="[^"]*"/gi)) console.log('DATA:',m[0]);
console.log('--- any "of N" or "showing" ---');
for(const m of html.matchAll(/showing[^<]{0,40}|1\s*[-–]\s*\d+\s*of\s*\d+/gi)) console.log('SHOW:',m[0].replace(/\s+/g,' '));
