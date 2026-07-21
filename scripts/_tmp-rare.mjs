const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
for(const qs of ['fuels=Electric','gearboxes=Manual']){
  const h=await get(`https://bundabergmotorgroup.com.au/new-demo-used-vehicles/?${qs}`);
  const of=h.match(/of\s+(\d+)\s+results/i);
  const showing=h.match(/Showing[^<]{0,40}/i);
  const none=/no\s+(?:results|vehicles|matching)/i.test(h);
  const slugs=new Set([...h.matchAll(/(\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4})\//gi)].map(m=>m[1]));
  console.log(qs.padEnd(20),'| of-results:',of?of[1]:'—','| showing:',showing?showing[0].replace(/\s+/g,' '):'—','| noResultsMsg:',none,'| slugsOnPage:',slugs.size);
}
