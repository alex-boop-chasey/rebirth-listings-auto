const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const slugRe=/(\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4})\//gi;
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return {status:r.status,html:await r.text()};}
for (const cat of ['new-vehicles','used-vehicles','demo-vehicles']){
  const seen=new Set(); let page=1; let pagesInfo='';
  // gather slugs across pagination (try ?page=N up to a cap)
  while(page<=15){
    const url=page===1?`https://bundabergmotorgroup.com.au/${cat}/`:`https://bundabergmotorgroup.com.au/${cat}/page/${page}/`;
    const {status,html}=await get(url);
    if(status!==200) { break; }
    const before=seen.size;
    for(const m of html.matchAll(slugRe)) seen.add(m[1]);
    const added=seen.size-before;
    if(page===1){
      // look for a result count text and pagination hints
      const cnt=html.match(/(\d+)\s+(vehicles|results|cars|matches)/i);
      pagesInfo=cnt?cnt[0]:'(no count text)';
    }
    if(added===0 && page>1) break;
    page++;
  }
  console.log(cat.padEnd(16), 'uniqueSlugs=',seen.size, '| pagesScanned=',page-1, '|', pagesInfo);
}
