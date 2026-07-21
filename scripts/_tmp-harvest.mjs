const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});if(!r.ok)throw new Error(u+' '+r.status);return r.text();}
const cats={'new-vehicles':200,'used-vehicles':56,'demo-vehicles':52};
const all=[];
for(const [cat,total] of Object.entries(cats)){
  for(let start=0;start<total;start+=20){
    const h=await get(`https://bundabergmotorgroup.com.au/${cat}/?start=${start}`);
    // split into stock-item blocks
    const blocks=h.split('class="stock-item stockListItem');
    for(let bi=1;bi<blocks.length;bi++){
      const b=blocks[bi];
      const g=(re)=>{const m=b.match(re);return m?m[1].trim():undefined;};
      const url=g(/href="((?:\d{5,}-\d{5,}-[a-z0-9-]+?-\d{4}))\//i);
      if(!url) continue;
      const rec={
        cat,
        stock:g(/data-stocknumber="([^"]*)"/),
        year:g(/data-stockyear="([^"]*)"/),
        make:g(/data-stockmake="([^"]*)"/),
        model:g(/data-stockmodel="([^"]*)"/),
        body:g(/data-stockbody="([^"]*)"/),
        price:g(/data-stockprice="([^"]*)"/),
        drive:g(/title-sub-drive-type">\s*([^<]*)</),
        badge:g(/title-badge">\s*([^<>]*?)(?:<|$)/),
        cond:g(/si-type[^>]*>\s*([A-Za-z]+)\s*</),
        title:(b.match(/si-title stockListItemTitleList">([\s\S]*?)<\/h3>/)||[])[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,70),
        url,
      };
      all.push(rec);
    }
    await sleep(120);
  }
}
import('node:fs').then(fs=>fs.writeFileSync('scripts/_tmp-inventory.json',JSON.stringify(all,null,1)));
console.log('HARVESTED',all.length,'records');
// distributions
const dist=(k)=>{const m={};for(const r of all){const v=(r[k]||'—');m[v]=(m[v]||0)+1;}return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
console.log('\nBODY:',JSON.stringify(dist('body')));
console.log('\nCOND:',JSON.stringify(dist('cond')));
console.log('\nMAKE:',JSON.stringify(dist('make')));
console.log('\nDRIVE:',JSON.stringify(dist('drive')));
console.log('\nYEAR:',JSON.stringify(dist('year')));
