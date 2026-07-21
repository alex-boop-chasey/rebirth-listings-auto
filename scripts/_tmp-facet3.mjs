const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function count(qs){
  const r=await fetch(`https://bundabergmotorgroup.com.au/new-demo-used-vehicles/?${qs}`,{headers:{'user-agent':UA}});
  const h=await r.text();
  const m=h.match(/of\s+(\d+)\s+results/i);
  return m?m[1]:'?';
}
for(const v of ['Electric','Hybrid','Diesel','Petrol','Petrol-Electric','Plug-in Hybrid','PHEV','Electric/Petrol','Hybrid-Petrol']){
  console.log('fuels='+v.padEnd(18), await count('fuels='+encodeURIComponent(v)));
}
console.log('---');
for(const v of ['Manual','Automatic','Constantly Variable Transmission','Sports Automatic','Auto']){
  console.log('gearboxes='+v.padEnd(34), await count('gearboxes='+encodeURIComponent(v)));
}
