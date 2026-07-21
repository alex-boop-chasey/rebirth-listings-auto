const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
// pull JSON-LD images from 3 varied detail pages incl the Isuzu D-MAX flagged
const urls=['517507-1812505-hyundai-elexio-2026','516944-1846797-hyundai-i20-2026'];
// find a D-MAX url from candidates
import('node:fs').then(async fs=>{
  const c=JSON.parse(fs.readFileSync('scripts/_tmp-candidates.json','utf8'));
  const dmax=c.find(r=>r.make==='Isuzu');
  if(dmax) urls.push(dmax.url);
  for(const u of urls){
    const h=await get(`https://bundabergmotorgroup.com.au/${u}/`);
    // json-ld images
    let imgs=[];
    for(const m of h.matchAll(/"image"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)){try{const v=JSON.parse(m[1]);imgs=imgs.concat(v);}catch{}}
    // dom fallback
    const dom=[...new Set([...h.matchAll(/resource\.digitaldealer\.com\.au\/image\/([0-9a-f]+)_/gi)].map(m=>m[1]))].map(id=>`https://resource.digitaldealer.com.au/image/${id}_0_0.jpg`);
    const test=(imgs[0]||dom[0]);
    let status='none';
    if(test){const r=await fetch(test,{headers:{'user-agent':UA,referer:`https://bundabergmotorgroup.com.au/${u}/`}});status=r.status+' '+r.headers.get('content-type')+' '+(r.headers.get('content-length')||'?')+'B';}
    console.log(u.padEnd(40),'jsonld:',imgs.length,'dom:',dom.length,'| first img ->',status);
  }
});
