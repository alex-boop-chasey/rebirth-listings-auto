const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const paths=['new-vehicles','used-vehicles','demo-vehicles','vehicles','cars','stock','search-inventory'];
for (const p of paths){
  try{
    const r=await fetch(`https://bundabergmotorgroup.com.au/${p}/`,{headers:{'user-agent':UA},redirect:'manual'});
    console.log(p.padEnd(18), r.status, r.headers.get('location')||'');
  }catch(e){console.log(p,'ERR',e.message);}
}
