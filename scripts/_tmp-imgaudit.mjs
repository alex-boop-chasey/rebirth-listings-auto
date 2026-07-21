import fs from 'node:fs';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});return r.text();}
const c=JSON.parse(fs.readFileSync('scripts/_tmp-candidates.json','utf8')).filter(r=>!r.err);
let noimg=[];
for(const r of c){
  const h=await get(`https://bundabergmotorgroup.com.au/${r.url}/`);
  let imgs=[];
  for(const m of h.matchAll(/"image"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)){try{const v=JSON.parse(m[1]);imgs=imgs.concat(v);}catch{}}
  const dom=new Set([...h.matchAll(/resource\.digitaldealer\.com\.au\/image\/([0-9a-f]+)_/gi)].map(m=>m[1]));
  const n=Math.max(imgs.length,dom.size);
  r.imgCount=n;
  if(n===0) noimg.push(`${r.year} ${r.make} ${r.model} (${r.url})`);
  await sleep(80);
}
fs.writeFileSync('scripts/_tmp-candidates.json',JSON.stringify(c,null,1));
console.log('candidates:',c.length,'| with images:',c.filter(r=>r.imgCount>0).length,'| ZERO images:',noimg.length);
noimg.forEach(x=>console.log('  NOIMG:',x));
console.log('img count distribution:',JSON.stringify(c.map(r=>r.imgCount).sort((a,b)=>a-b)));
