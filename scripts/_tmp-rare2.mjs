const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
for(const qs of ['fuels=Electric','gearboxes=Manual']){
  const h=await get(`https://bundabergmotorgroup.com.au/new-demo-used-vehicles/?${qs}`);
  // only slugs inside stock-item blocks
  const blocks=h.split('class="stock-item stockListItem').slice(1);
  console.log('\n=== '+qs+' === stockItems:',blocks.length);
  for(const b of blocks){
    const url=(b.match(/href="((?:\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4}))\//i)||[])[1];
    const title=(b.match(/si-title stockListItemTitleList">([\s\S]*?)<\/h3>/)||[])[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
    const price=(b.match(/data-stockprice="([^"]*)"/)||[])[1];
    console.log('  ',url,'| $'+price,'|',title);
  }
}
