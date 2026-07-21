const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const slugRe=/(\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4})\//gi;
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
for(const cat of ['new-vehicles','used-vehicles','demo-vehicles','new-demo-used-vehicles']){
  const h=await get(`https://bundabergmotorgroup.com.au/${cat}/`);
  const of=h.match(/Showing\s+1\s*-\s*(\d+)\s+of\s+(\d+)\s+results/i);
  // fetch start=20 to confirm distinct slugs
  const h2=await get(`https://bundabergmotorgroup.com.au/${cat}/?start=20`);
  const s1=new Set([...h.matchAll(slugRe)].map(m=>m[1]));
  const s2=new Set([...h2.matchAll(slugRe)].map(m=>m[1]));
  const overlap=[...s2].filter(x=>s1.has(x)).length;
  console.log(cat.padEnd(24),'total=',of?of[2]:'?','| page1 slugs=',s1.size,'| page2(start=20) slugs=',s2.size,'| overlap=',overlap);
}
