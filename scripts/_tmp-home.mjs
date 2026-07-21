const base='http://localhost:4322';
let h='', status=0;
for(let i=0;i<30;i++){
  try{ const r=await fetch(base+'/',{redirect:'follow'}); status=r.status; h=await r.text();
    if(status===200) break;
  }catch(e){}
  await new Promise(r=>setTimeout(r,1500));
}
console.log('HTTP',status,'| html length',h.length);
if(status!==200){ console.log('BODY:',h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400)); process.exit(0);}
const cards=new Set([...h.matchAll(/href="\/listings\/([^"]+)"/g)].map(m=>m[1]));
const imgs=[...h.matchAll(/src="(https:\/\/cdn\.sanity\.io\/images\/[^"]+)"/g)];
const titles=[...h.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(m=>m[1].trim()).filter(Boolean);
console.log('unique listing cards:', cards.size);
console.log('sanity cdn <img> on page:', imgs.length);
console.log('sample titles:', JSON.stringify(titles.slice(0,8)));
if(imgs[0]){ const ir=await fetch(imgs[0][1]); console.log('first card image fetch:', ir.status, ir.headers.get('content-type')); }
