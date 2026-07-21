const r=await fetch('http://localhost:4322/');
const t=await r.text();
console.log('STATUS',r.status);
console.log(t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1200));
