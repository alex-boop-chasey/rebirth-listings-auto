const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const h=await get('https://bundabergmotorgroup.com.au/new-demo-used-vehicles/');
for(const key of ['fuels','gearboxes','bodies','seats']){
  console.log('\n===== '+key+' =====');
  const re=new RegExp(`${key}=([^"&]+)"[^>]*>([\\s\\S]{0,80}?)</a>`,'gi');
  const seen=new Set();
  for(const m of h.matchAll(re)){
    const val=decodeURIComponent(m[1]);
    const txt=m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const k=val+'|'+txt;
    if(seen.has(k))continue; seen.add(k);
    console.log(val.padEnd(16),'::',txt);
  }
}
