import {Capacitor} from '@capacitor/core';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import * as XLSX from 'xlsx';
import './style.css';
import {normalize,merge} from './data.js';

const native=Capacitor.getPlatform()!=='web',DIR='Esraa',DATA=DIR+'/data.json',BK=DIR+'/backup',LS='esraa.v3';
const $=id=>document.getElementById(id);
let S=[],locked=false,cur=new Date(),pending=null;cur.setDate(1);
const ar=(d,o)=>new Date(d).toLocaleString('ar-EG',o);
const tm=ms=>ar(ms,{hour:'2-digit',minute:'2-digit'});
const dur=ms=>{const m=Math.round(ms/6e4);return Math.floor(m/60)+'س '+m%60+'د';};
const hrs=ms=>Math.round(ms/36e5*100)/100;
const len=s=>(s.o??Date.now())-s.i;
const pad=n=>String(n).padStart(2,'0');
const dkey=ms=>{const d=new Date(ms);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const open_=()=>S.find(s=>s.o==null);
const month=()=>S.filter(s=>{const d=new Date(s.i);return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth();});
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2800);}
const TH=['dark','light','auto'],THI={auto:'◐',dark:'☾',light:'☀'},THN={auto:'تلقائي (حسب الجهاز)',dark:'داكن',light:'فاتح'};
function applyTheme(){const t=localStorage.getItem('esraa.theme')||'dark',dk=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dk?'dark':'light';$('tb').textContent=THI[t];}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',applyTheme);
const buzz=()=>navigator.vibrate&&navigator.vibrate(12);

const fsr=(p,dir=Directory.Data)=>Filesystem.readFile({path:p,directory:dir,encoding:Encoding.UTF8}).then(r=>typeof r.data==='string'?r.data:'');
const fsw=(p,t,dir=Directory.Data)=>Filesystem.writeFile({path:p,directory:dir,data:t,encoding:Encoding.UTF8,recursive:true});
// التخزين الأساسي داخل مساحة التطبيق الخاصة (دايمًا مقروءة/مكتوبة) + نسخة مرآة في localStorage
async function load(){
  const c=[];
  if(native)try{c.push(await fsr(DATA));}catch{}
  const l=localStorage.getItem(LS);if(l!=null)c.push(l);
  if(!c.length)return[];
  for(const raw of c)try{return normalize(JSON.parse(raw)).list;}catch{}
  locked=true;throw new Error('corrupt');
}
async function save(msg){
  if(locked){toast('الملف غير مقروء — الحفظ متوقف لحماية بياناتك');return false;}
  const p=JSON.stringify(S,null,2);let ok=false;
  try{localStorage.setItem(LS,p);ok=true;}catch{}
  if(native)try{await fsw(DATA,p);ok=true;}catch{}
  render();
  if(!ok){toast('تعذر الحفظ — صدّر نسخة JSON الآن');return false;}
  if(msg)toast(msg);return true;
}
async function snapshot(tag){if(native&&S.length)try{await fsw(`${DIR}/recovery/${tag}-${Date.now()}.json`,JSON.stringify(S,null,2));}catch{}}
async function backup(manual){
  if(locked||!native)return manual&&toast(native?'الملف غير مقروء':'النسخ الداخلي للتطبيق فقط');
  const d=new Date(),n=manual?`data-${dkey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`:`data-${dkey(d)}.json`,j=JSON.stringify(S,null,2);
  try{await fsw(`${BK}/${n}`,j);if(manual)toast('تم حفظ نسخة احتياطية');}catch{manual&&toast('تعذر حفظ النسخة');}
  fsw(`${BK}/${n}`,j,Directory.Documents).catch(()=>{});
}
async function shareFile(name,data,enc){
  if(!native){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data]));a.download=name;a.click();return;}
  const f=await Filesystem.writeFile({path:name,directory:Directory.Cache,data,encoding:enc,recursive:true});
  await Share.share({title:name,files:[f.uri],dialogTitle:'Esraa'});
}

const sheet=h=>{$('sheet').innerHTML=h;$('sw').classList.add('on');};
const closeSheet=()=>$('sw').classList.remove('on');
function dataSheet(){sheet(`<h3>إدارة البيانات</h3><p>${S.length} حركة محفوظة. الاستيراد يقبل أي ملف JSON حتى لو من نسخة قديمة.</p>
<div class="list"><button class="btn pri" data-act="import">⬆ استيراد ملف (JSON)</button>
<button class="btn" data-act="restoreList">↺ استرجاع من نسخة داخل التطبيق</button>
<button class="btn" data-act="bknow">💾 نسخة احتياطية الآن</button>
<button class="btn" data-act="expjson">⬇ تصدير JSON ومشاركته</button>
<button class="btn" data-act="expxl">📊 تصدير Excel للشهر الحالي</button>
<button class="btn del" data-act="clear">🗑 مسح هذا الشهر</button></div>`);}
async function restoreList(){
  let files=[];if(native)try{files=(await Filesystem.readdir({path:BK,directory:Directory.Data})).files.filter(f=>f.name.endsWith('.json')).sort((a,b)=>b.name.localeCompare(a.name));}catch{}
  if(!files.length){toast('لا توجد نسخ داخلية بعد');return;}
  sheet(`<h3>النسخ المتاحة</h3><div class="list">${files.slice(0,15).map(f=>`<button class="btn" data-act="pick" data-n="${f.name}">${f.name.replace(/^data-|\.json$/g,'')}<small>اختيار</small></button>`).join('')}</div>`);
}
function preview(text,label){
  let r;try{r=normalize(JSON.parse(text.replace(/^\uFEFF/,'')));}catch(e){toast('الملف غير صالح: '+(e.message||'JSON'));return;}
  if(!r.list.length){toast('لا توجد حركات صالحة في الملف');return;}
  pending=r.list;const a=r.list[0].i,b=r.list[r.list.length-1].i,m=merge(S,r.list).added;
  sheet(`<h3>معاينة الاستيراد</h3><p>${label}<br>وُجدت <b>${r.list.length}</b> حركة من ${ar(a,{day:'numeric',month:'short',year:'numeric'})} إلى ${ar(b,{day:'numeric',month:'short',year:'numeric'})}${r.skipped?` (تم تجاهل ${r.skipped} غير صالحة)`:''}.<br>الجديد عن بياناتك الحالية: <b>${m}</b> حركة.</p>
<div class="row"><button class="btn pri" data-act="doMerge">دمج</button><button class="btn del" data-act="doReplace">استبدال الكل</button></div><div class="row"><button class="btn" data-act="close">إلغاء</button></div>`);
}
async function apply(replace){
  if(!pending)return;await snapshot('before-import');
  if(replace){S=pending;locked=false;}else{if(locked){toast('الملف الحالي غير مقروء — اختر استبدال');return;}S=merge(S,pending).list;}
  pending=null;closeSheet();await save(`تم الاستيراد — ${S.length} حركة`);
}
function form(r){
  const i=r?.i??Date.now(),o=r?r.o:null,d=new Date(i);
  const t=ms=>ms==null?'':pad(new Date(ms).getHours())+':'+pad(new Date(ms).getMinutes());
  sheet(`<h3>${r?'تعديل حركة':'إضافة يدوية'}</h3>
<label class="fld">التاريخ<input type="date" id="fd" value="${dkey(i)}"></label>
<div class="row"><label class="fld">الحضور<input type="time" id="fi" value="${t(i)}"></label><label class="fld">الانصراف<input type="time" id="fo" value="${t(o)}"></label></div>
<p>لو الانصراف أبكر من الحضور يُحسب في اليوم التالي (وردية ليلية).</p>
<div class="row">${r?`<button class="btn del" data-act="del" data-id="${r.id}">حذف</button>`:''}<button class="btn pri" data-act="saveForm" data-id="${r?r.id:''}">حفظ</button></div>`);
}
async function saveForm(id){
  const d=$('fd').value,a=$('fi').value,o=$('fo').value;if(!d||!a){toast('اختر التاريخ ووقت الحضور');return;}
  const i=new Date(d+'T'+a).getTime();let e=o?new Date(d+'T'+o).getTime():null;if(e!=null&&e<=i)e+=864e5;
  if(e==null&&S.some(s=>s.o==null&&String(s.id)!==id)){toast('يوجد حضور مفتوح بالفعل');return;}
  if(id){const s=S.find(x=>String(x.id)===id);if(s){s.i=i;s.o=e;}}else S.push({id:Date.now(),i,o:e});
  S.sort((x,y)=>x.i-y.i);cur=new Date(i);cur.setDate(1);closeSheet();await save('تم الحفظ');
}
function render(){
  const s=open_();$('hero').className='hero'+(s?' on':'');
  const m=month().sort((a,b)=>a.i-b.i),tot=m.reduce((a,x)=>a+len(x),0),days={};m.forEach(x=>days[dkey(x.i)]=(days[dkey(x.i)]||0)+len(x));const nd=Object.keys(days).length;
  $('mname').textContent=ar(cur,{month:'long',year:'numeric'});
  $('stats').innerHTML=`<div class="st big"><span>إجمالي ساعات الشهر</span><b>${dur(tot)} <small style="font-size:14px;color:var(--m)">(${hrs(tot)} ساعة)</small></b></div><div class="st"><span>أيام الحضور</span><b>${nd.toLocaleString('ar-EG')}</b></div><div class="st"><span>متوسط اليوم</span><b>${nd?dur(tot/nd):'—'}</b></div>`;
  if(!m.length){$('log').innerHTML='<div class="empty">لا توجد حركات في هذا الشهر</div>';tick();return;}
  const g={},ord=[];m.forEach(x=>{const k=dkey(x.i);(g[k]=g[k]||(ord.push(k),[])).push(x);});
  $('log').innerHTML=ord.reverse().map(k=>`<div class="day"><div class="dh"><span>${ar(g[k][0].i,{weekday:'long',day:'numeric',month:'long'})}</span><em>${dur(days[k])}</em></div>${g[k].map(x=>`<div class="se" data-act="edit" data-id="${x.id}"><span class="t"><u>${tm(x.i)}</u> — <s>${x.o?tm(x.o):'مستمر'}</s></span><b>${dur(len(x))}</b></div>`).join('')}</div>`).join('');
  tick();
}
const greet=()=>{const h=new Date().getHours();return (h<5?'لسه صاحية يا إسراء':h<12?'صباح الخير يا إسراء':h<18?'نهارك سعيد يا إسراء':'مساء الخير يا إسراء')+' ♥';};
function tick(){
  const s=open_(),n=new Date();
  $('hero').innerHTML=`<div class="greet">${greet()}</div><div class="clock">${s?(()=>{const t=Math.floor((Date.now()-s.i)/1000);return pad(Math.floor(t/3600))+':'+pad(Math.floor(t/60)%60)+':'+pad(t%60);})():ar(n,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
<div class="sub">${s?'مدة الجلسة الحالية':ar(n,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
<div class="badge">${s?'الحضور مسجل — العمل مستمر':'غير مسجل حضور'}</div><button class="main" data-act="toggle">${s?'انصراف':'تسجيل حضور'}</button>`;
}
async function exportXl(){
  const m=month().sort((a,b)=>a.i-b.i);if(!m.length){toast('لا توجد حركات في هذا الشهر');return;}
  const rows=m.map(s=>({'التاريخ':ar(s.i,{day:'numeric',month:'numeric',year:'numeric'}),'اليوم':ar(s.i,{weekday:'long'}),'الحضور':tm(s.i),'الانصراف':s.o?tm(s.o):'لم ينصرف','المدة':dur(len(s)),'الساعات':hrs(len(s))}));
  const tot=m.reduce((a,x)=>a+len(x),0);rows.push({'التاريخ':'','اليوم':'','الحضور':'','الانصراف':'الإجمالي','المدة':dur(tot),'الساعات':hrs(tot)});
  const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[14,12,12,12,12,10].map(wch=>({wch}));
  const wb=XLSX.utils.book_new();wb.Workbook={Views:[{RTL:true}]};XLSX.utils.book_append_sheet(wb,ws,'Esraa');
  const name=`Esraa-${cur.getFullYear()}-${pad(cur.getMonth()+1)}.xlsx`;
  await shareFile(name,native?XLSX.write(wb,{type:'base64',bookType:'xlsx'}):XLSX.write(wb,{type:'array',bookType:'xlsx'}),undefined);
}
const A={
  theme:()=>{const t=localStorage.getItem('esraa.theme')||'dark',n=TH[(TH.indexOf(t)+1)%3];localStorage.setItem('esraa.theme',n);applyTheme();toast('المظهر: '+THN[n]);},
  toggle:async()=>{buzz();const s=open_();if(s)s.o=Date.now();else S.push({id:Date.now(),i:Date.now(),o:null});await save(s?'تم تسجيل الانصراف':'تم تسجيل الحضور');},
  prev:()=>{cur.setMonth(cur.getMonth()-1);render();},next:()=>{cur.setMonth(cur.getMonth()+1);render();},
  data:dataSheet,add:()=>form(null),close:closeSheet,edit:(e)=>form(S.find(x=>String(x.id)===e.dataset.id)),
  saveForm:e=>saveForm(e.dataset.id),
  del:async e=>{S=S.filter(x=>String(x.id)!==e.dataset.id);closeSheet();await save('تم الحذف');},
  import:()=>{$('file').value='';$('file').click();},restoreList,bknow:()=>backup(true),
  pick:async e=>{try{preview(await fsr(`${BK}/${e.dataset.n}`),'من نسخة داخلية: '+e.dataset.n);}catch{toast('تعذر قراءة النسخة');}},
  doMerge:()=>apply(false),doReplace:()=>apply(true),
  expjson:async()=>{try{await shareFile(`esraa-${dkey(Date.now())}.json`,JSON.stringify(S,null,2),Encoding.UTF8);}catch{toast('تعذر التصدير');}},
  expxl:()=>exportXl().catch(()=>toast('تعذر تصدير Excel')),
  clear:async()=>{const ids=new Set(month().map(x=>x.id));if(!ids.size)return;if(confirm(`مسح ${ids.size} حركة من هذا الشهر؟ (تُحفظ نسخة أمان)`)){await snapshot('before-clear');S=S.filter(x=>!ids.has(x.id));closeSheet();await save('تم المسح');}}
};
document.addEventListener('click',e=>{
  if(e.target.id==='sw')return closeSheet();
  const b=e.target.closest('[data-act]');if(b&&A[b.dataset.act])A[b.dataset.act](b);
});
$('file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{preview(await f.text(),'الملف: '+f.name);}catch{toast('تعذر قراءة الملف');}});
(async()=>{
  try{S=await load();}catch{S=[];toast('ملف البيانات تالف — استورد نسخة سليمة (الحفظ متوقف حتى تستبدله)');}
  applyTheme();render();backup(false);setInterval(tick,1000);
})();
