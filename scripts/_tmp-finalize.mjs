import fs from 'node:fs';
let R=JSON.parse(fs.readFileSync('scripts/_tmp-candidates.json','utf8')).filter(r=>!r.err && r.imgCount>0);
const fix=r=>{const s={...r.specs};if(!s.driveType&&/4x2|4 x 2/i.test(r.drive||''))s.driveType='2wd';if(!s.transmission&&/reduction gear/i.test(r.trans||''))s.transmission='auto';return {...r,fixed:s};};
let A=R.map(fix);
// collapse exact near-duplicates: same make+model+fuel+drive+price -> keep one
const dk=r=>[r.make,r.model,r.fixed.fuelType,r.fixed.driveType,r.price].join('|');
const dseen=new Set(); A=A.filter(r=>{const k=dk(r);if(dseen.has(k))return false;dseen.add(k);return true;});
const rare=A.filter(r=>r.why==='EV'||r.why==='MANUAL');
const nonSuv=A.filter(r=>r.fixed.bodyType&&r.fixed.bodyType!=='suv'&&!rare.includes(r));
let suv=A.filter(r=>r.fixed.bodyType==='suv'&&!rare.includes(r));
suv.sort((a,b)=>a.price-b.price);
const key=r=>[r.cond,r.make,r.fixed.fuelType,r.fixed.driveType,r.fixed.seatCount].join('|');
const seen=new Set();const suvPick=[];
for(const r of suv){const k=key(r);if(!seen.has(k)){seen.add(k);suvPick.push(r);}}
let sel=[...rare,...nonSuv,...suvPick];
const um=new Map();for(const r of sel)if(!um.has(r.url))um.set(r.url,r);sel=[...um.values()];
// prefer trimming $0 SUVs first if over 40
if(sel.length>40){const drop=sel.filter(r=>r.fixed.bodyType==='suv'&&r.price===0).slice(0,sel.length-40).map(r=>r.url);const ds=new Set(drop);sel=sel.filter(r=>!ds.has(r.url));}
if(sel.length>40){const drop=sel.filter(r=>r.fixed.bodyType==='suv'&&r.fixed.fuelType==='petrol'&&r.cond==='new').slice(0,sel.length-40).map(r=>r.url);const ds=new Set(drop);sel=sel.filter(r=>!ds.has(r.url));}
if(sel.length>40)sel=sel.slice(0,40);
if(sel.length<40){const extra=suv.filter(r=>!sel.includes(r)).slice(0,40-sel.length);sel=[...sel,...extra];}
const pad=(s,n)=>String(s??'—').slice(0,n).padEnd(n);
sel.sort((a,b)=>(a.cond||'z').localeCompare(b.cond||'z')||a.make.localeCompare(b.make)||a.model.localeCompare(b.model));
console.log('N =',sel.length,'  (all have images, POA shown as $0)\n');
console.log(pad('#',3),pad('Year',5),pad('Make',9),pad('Model',16),pad('Cond',5),pad('Body',9),pad('Fuel',8),pad('Trans',6),pad('Drv',4),pad('St',3),pad('Odo km',7),pad('Price',8),'Img');
sel.forEach((r,i)=>console.log(pad(i+1,3),pad(r.year,5),pad(r.make,9),pad(r.model,16),pad(r.cond,5),pad(r.fixed.bodyType,9),pad(r.fixed.fuelType,8),pad(r.fixed.transmission,6),pad(r.fixed.driveType,4),pad(r.fixed.seatCount,3),pad(r.odo,7),pad('$'+r.price,8),r.imgCount));
const d=(f,g)=>{const m={};for(const r of sel){const v=g(r)??'(none)';m[v]=(m[v]||0)+1;}return f+': '+Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'×'+v).join(', ');};
console.log('\n'+d('condition',r=>r.cond));
console.log(d('bodyType',r=>r.fixed.bodyType));
console.log(d('fuelType',r=>r.fixed.fuelType));
console.log(d('transmission',r=>r.fixed.transmission));
console.log(d('driveType',r=>r.fixed.driveType));
console.log(d('seatCount',r=>r.fixed.seatCount));
console.log(d('make',r=>r.make));
const yrs=sel.map(r=>r.year).filter(Boolean).sort();console.log('year: '+yrs[0]+'–'+yrs[yrs.length-1]+' (distinct '+new Set(yrs).size+')');
const pr=sel.map(r=>r.price).filter(p=>p>0).sort((a,b)=>a-b);console.log('price(non-POA): $'+pr[0].toLocaleString()+' – $'+pr[pr.length-1].toLocaleString()+' | POA count: '+sel.filter(r=>r.price===0).length);
fs.writeFileSync('scripts/_tmp-final40.json',JSON.stringify(sel.map(r=>({url:r.url,condition:r.cond,make:r.make,model:r.model,year:r.year,price:r.price})),null,1));
