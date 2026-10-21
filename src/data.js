const num=v=>{if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?(v<1e11?v*1000:v):null;const t=Date.parse(v);return Number.isFinite(t)?t:null;};
export function normalize(raw){
  let a=raw;
  if(a&&!Array.isArray(a))a=a.data??a.sessions??a.records??a.entries??a.log;
  if(!Array.isArray(a))throw new Error('الملف لا يحتوي قائمة حركات');
  const list=[],seen=new Set();let skipped=0;
  a.forEach((r,n)=>{
    const i=num(r?.i??r?.in??r?.start??r?.checkIn),o=num(r?.o??r?.out??r?.end??r?.checkOut);
    if(i==null||(o!=null&&o<=i)){skipped++;return;}
    let id=Number.isFinite(+r.id)?+r.id:i+n;while(seen.has(id))id++;seen.add(id);
    list.push({id,i,o});
  });
  list.sort((x,y)=>x.i-y.i);
  if(list.filter(x=>x.o==null).length>1){list.forEach((x,k)=>{if(x.o==null&&k<list.length-1){x.o=list[k+1].i;}});}
  return{list,skipped};
}
export function merge(cur,add){
  const ids=new Set(cur.map(x=>x.id)),starts=new Set(cur.map(x=>x.i));let added=0;
  const out=cur.slice();
  add.forEach(x=>{if(ids.has(x.id)||starts.has(x.i))return;out.push(x);added++;});
  out.sort((a,b)=>a.i-b.i);return{list:out,added};
}
