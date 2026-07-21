import fs from 'node:fs';
import { specsFromDetails, matchSpecField } from './lib/vehicle-specs.ts';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){const r=await fetch(u,{headers:{'user-agent':UA}});if(!r.ok)throw new Error(u+' '+r.status);return r.text();}
const ORIGIN='https://bundabergmotorgroup.com.au';
const stripTags=s=>s.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
function specTable(html){const out={};for(const m of html.matchAll(/<span class="val ([^"]*?)\s*">([\s\S]*?)<\/span>/gi)){const l=m[1].trim();const v=stripTags(m[2]);if(l&&v&&!(l in out))out[l]=v;}return out;}
function jsonld(html){const blocks=[...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];let vehicle=null;for(const b of blocks){let p;try{p=JSON.parse(b[1].trim());}catch{continue;}const nodes=Array.isArray(p)?p:(p['@graph']??[p]);for(const n of nodes){const t=n?.['@type'];const ts=Array.isArray(t)?t:[t];if(ts.includes('Vehicle')&&!vehicle)vehicle=n;}}return vehicle;}
const firstInt=s=>{if(s==null)return undefined;const m=String(s).match(/-?\d[\d,]*/);return m?Number(m[0].replace(/,/g,'')):undefined;};
const driveMap={FrontWheelDriveConfiguration:'Front Wheel Drive',RearWheelDriveConfiguration:'Rear Wheel Drive',AllWheelDriveConfiguration:'All Wheel Drive',FourWheelDriveConfiguration:'Four Wheel Drive'};

const inv=JSON.parse(fs.readFileSync('scripts/_tmp-inventory.json','utf8'));
// normalize helpers for pre-stratification
const bodyEnum=b=>{b=(b||'').toLowerCase();if(b.includes('suv'))return'suv';if(b.includes('hatch'))return'hatchback';if(b.includes('sedan'))return'sedan';if(/ute|cab|pickup/.test(b))return'ute';if(b.includes('wagon'))return'wagon';if(/van|people/.test(b))return'van';return b||'?';};
const condEnum=c=>{c=(c||'').toLowerCase();if(c.startsWith('demo'))return'demo';if(c.startsWith('used'))return'used';if(c.startsWith('new'))return'new';return'?';};
for(const r of inv){r.b=bodyEnum(r.body);r.c=condEnum(r.cond);r.p=Number(r.price)||0;r.y=Number(r.year)||0;}

// --- Build stratified candidate set (URLs) ---
const pick=new Map(); // url -> reason
const add=(r,why)=>{if(r&&!pick.has(r.url))pick.set(r.url,{...r,why});};
// rare must-includes
const byUrl=u=>inv.find(r=>r.url===u);
add(byUrl('517506-1849662-jaecoo-j5-2026'),'EV');
add(byUrl('517507-1812505-hyundai-elexio-2026'),'EV');
add(byUrl('516944-1846797-hyundai-i20-2026'),'MANUAL');
// every non-SUV body: take a spread across condition & make
const nonSuv=inv.filter(r=>r.b!=='suv');
for(const b of ['ute','wagon','hatchback','sedan','van']){
  const grp=nonSuv.filter(r=>r.b===b);
  // spread by condition and price
  grp.sort((a,z)=>a.p-z.p);
  const take=b==='ute'?6:b==='van'?4:4;
  const step=Math.max(1,Math.floor(grp.length/take));
  for(let i=0;i<grp.length&&[...pick.values()].filter(x=>x.b===b).length<take;i+=step) add(grp[i],'body:'+b);
}
// SUVs: spread across condition, make, year, price, drive
const suv=inv.filter(r=>r.b==='suv');
// diverse makes
const makesSeen={};
suv.sort((a,z)=>a.p-z.p);
for(const cond of ['new','used','demo']){
  const g=suv.filter(r=>r.c===cond);
  const step=Math.max(1,Math.floor(g.length/7));
  for(let i=0;i<g.length;i+=step){ if([...pick.values()].filter(x=>x.b==='suv'&&x.c===cond).length>=7)break; add(g[i],'suv:'+cond);}
}
// ensure make diversity: add one of each under-represented make
const haveMakes=new Set([...pick.values()].map(x=>x.make));
for(const mk of ['Isuzu','Subaru','Nissan','Kia','Hyundai','LDV','Ram','Ford','Mitsubishi','Toyota','Mazda','Jaecoo','GWM']){
  if(!haveMakes.has(mk)){const r=inv.find(x=>x.make===mk);add(r,'make:'+mk);haveMakes.add(mk);}
}
const cands=[...pick.values()];
console.log('CANDIDATES:',cands.length);

// --- fetch detail pages, assemble details rows for the spec-relevant labels, run mapper ---
const results=[];
for(const c of cands){
  try{
    const html=await get(`${ORIGIN}/${c.url}/`);
    const sp=specTable(html); const v=jsonld(html);
    const clean=x=>{if(x==null)return undefined;const t=String(x).trim();return t&&!/^\(?\s*(no series|n\/?a|tba|unknown)\s*\)?$/i.test(t)?t:undefined;};
    const body=clean(sp['Body'])??clean(v?.bodyType);
    const fuel=clean(sp['Fuel Type'])??clean(v?.fuelType);
    const trans=clean(sp['Transmission'])??clean(v?.vehicleTransmission);
    const drive=clean(sp['Drive Type'])??driveMap[(v?.driveWheelConfiguration||'').split('/').pop()];
    const seats=firstInt(v?.vehicleSeatingCapacity)??firstInt(sp['Seats']);
    const odo=firstInt(v?.mileageFromOdometer?.value)??firstInt(sp['Odometer']);
    const year=firstInt(v?.vehicleModelDate)??c.y;
    // details rows exactly as importer feeds mapper
    const details=[
      {label:'Model Year',valueType:'number',valueNumber:year},
      {label:'Odometer',valueType:'number',valueNumber:odo,unit:'km'},
      {label:'Body',valueType:'text',value:body},
      {label:'Fuel Type',valueType:'text',value:fuel},
      {label:'Transmission',valueType:'text',value:trans},
      {label:'Drive Type',valueType:'text',value:drive},
      {label:'Seats',valueType:'number',valueNumber:seats},
    ].filter(d=>d.value!=null||d.valueNumber!=null);
    const warns=[];
    const specs=specsFromDetails(details,{onWarn:m=>warns.push(m)});
    const imgs=(Array.isArray(v?.image)?v.image:[]).length || (html.match(/resource\.digitaldealer\.com\.au\/image\//g)||[]).length>0?1:0;
    results.push({url:c.url,why:c.why,cond:c.c,make:c.make,model:c.model,year,price:c.p,body,fuel,trans,drive,seats,odo,specs,warns,hasImg:imgs>0});
  }catch(e){results.push({url:c.url,err:e.message});}
  await sleep(150);
}
fs.writeFileSync('scripts/_tmp-candidates.json',JSON.stringify(results,null,1));
const ok=results.filter(r=>!r.err);
console.log('FETCHED ok:',ok.length,'errors:',results.length-ok.length);
console.log('WITH WARNS:',ok.filter(r=>r.warns.length).length);
for(const r of ok.filter(r=>r.warns.length)) console.log('  WARN',r.make,r.model,'::',r.warns.join('; '),'|| raw fuel/trans/drive:',r.fuel,'/',r.trans,'/',r.drive);
// coverage of enum fields
const cov=f=>{const m={};for(const r of ok){const v=r.specs[f]??'(none)';m[v]=(m[v]||0)+1;}return m;};
for(const f of ['bodyType','fuelType','transmission','driveType','seatCount']) console.log(f,JSON.stringify(cov(f)));
console.log('missing image:',ok.filter(r=>!r.hasImg).map(r=>r.make+' '+r.model));
