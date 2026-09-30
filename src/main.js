import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';

const DATA_PATH = 'SonyTime/data.json';
const BACKUP_DIR = 'SonyTime/backup';
const EXPORT_DIR = 'SonyTime/exports';
const BACKUP_META_KEY = 'sonytime.lastBackupDate';
const LAST_EXPORT_KEY = 'sonytime.lastExportPath';
const isNative = Capacitor.getPlatform() !== 'web';

let S = [];
let cur = new Date();
cur.setDate(1);
let lastExportUri = null;

const $ = (id) => document.getElementById(id);

function toast(m) {
  const t = $('toast');
  t.textContent = m;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2600);
}
function dur(ms) { const m=Math.round(ms/6e4),h=Math.floor(m/60); return h+'س '+(m%60)+'د'; }
function hrs(ms) { return Math.round(ms/36e5*100)/100; }
function tm(ms) { return new Date(ms).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}); }
function dk(ms) { const d=new Date(ms); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function open_() { return S.find(s=>s.o==null); }
function len(s) { return (s.o==null?Date.now():s.o)-s.i; }
function inMonth(s) { const d=new Date(s.i); return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth(); }
function mine() { return S.filter(inMonth).sort((a,b)=>a.i-b.i); }
function todayKey() { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

async function nativeRead(path) {
  const r = await Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 });
  return typeof r.data === 'string' ? r.data : new TextDecoder().decode(r.data);
}
async function nativeWrite(path, text) {
  await Filesystem.writeFile({ path, directory: Directory.Documents, data: text, encoding: Encoding.UTF8, recursive: true });
}
async function exists(path) {
  try { await Filesystem.stat({ path, directory: Directory.Documents }); return true; } catch { return false; }
}
async function readData() {
  if (isNative) {
    try { return JSON.parse(await nativeRead(DATA_PATH)); } catch { return []; }
  }
  try { return JSON.parse(localStorage.getItem('sonytime.v1.1') || '[]'); } catch { return []; }
}
async function writeData() {
  const payload = JSON.stringify(S, null, 2);
  if (isNative) await nativeWrite(DATA_PATH, payload);
  else localStorage.setItem('sonytime.v1.1', payload);
}

async function makeDailyBackup() {
  const key = todayKey();
  const previous = isNative ? await readNativeMeta() : localStorage.getItem(BACKUP_META_KEY);
  if (previous === key) return;
  try {
    const payload = JSON.stringify(S, null, 2);
    if (isNative) {
      await nativeWrite(`${BACKUP_DIR}/data-${key}.json`, payload);
      await nativeWrite('SonyTime/.last_backup_date.txt', key);
    } else {
      localStorage.setItem('sonytime.backup.'+key, payload);
      localStorage.setItem(BACKUP_META_KEY, key);
    }
    if (isNative) $('storageStatus').textContent = `نسخة اليوم محفوظة تلقائيًا • ${key}`;
  } catch (e) {
    $('storageStatus').textContent = 'التخزين المحلي يعمل — تعذر إنشاء نسخة اليوم';
  }
}
async function readNativeMeta() { try { return (await nativeRead('SonyTime/.last_backup_date.txt')).trim(); } catch { return null; } }

async function listBackups() {
  if (!isNative) {
    return Object.keys(localStorage).filter(k=>k.startsWith('sonytime.backup.')).map(k=>({name:k.replace('sonytime.backup.',''),key:k})).sort((a,b)=>b.name.localeCompare(a.name));
  }
  try {
    const r = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents });
    return r.files.filter(f=>f.name.endsWith('.json')).sort((a,b)=>b.name.localeCompare(a.name));
  } catch { return []; }
}
async function restoreLatestBackup() {
  const backups = await listBackups();
  if (!backups.length) { toast('لا توجد نسخة احتياطية بعد'); return; }
  try {
    let raw;
    if (isNative) raw = await nativeRead(`${BACKUP_DIR}/${backups[0].name}`);
    else raw = localStorage.getItem(backups[0].key);
    const restored = JSON.parse(raw);
    if (!Array.isArray(restored)) throw new Error('invalid');
    S = restored;
    await writeData();
    render();
    toast(`تم الاسترجاع من ${backups[0].name || backups[0].name}`);
  } catch { toast('تعذر قراءة النسخة الاحتياطية'); }
}

async function exportExcel() {
  const r=rows();
  if(!r.length){toast('لا توجد سجلات في هذا الشهر');return;}
  const tot=mine().reduce((a,s)=>a+len(s),0);
  r.push({'التاريخ':'','اليوم':'','الحضور':'','الانصراف':'الإجمالي','المدة':dur(tot),'الساعات':hrs(tot)});
  const name=`Sony-time-${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}.xlsx`;
  const ws=XLSX.utils.json_to_sheet(r);
  ws['!cols']=[{wch:14},{wch:12},{wch:12},{wch:12},{wch:12},{wch:10}];
  const wb=XLSX.utils.book_new();
  wb.Workbook={Views:[{RTL:true}]};
  XLSX.utils.book_append_sheet(wb,ws,'Sony time');
  const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const base64=bytesToBase64(new Uint8Array(bytes));

  if (isNative) {
    const path=`${EXPORT_DIR}/${name}`;
    await Filesystem.writeFile({path,directory:Directory.Documents,data:base64,recursive:true});
    const uri=await Filesystem.getUri({path,directory:Directory.Documents});
    lastExportUri=uri.uri;
    localStorage.setItem(LAST_EXPORT_KEY, lastExportUri);
    $('share').disabled=false;
    toast(`تم حفظ Excel في Documents/SonyTime/exports/${name}`);
  } else {
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
    lastExportUri=url;
    $('share').disabled=false;
    toast(`تم تصدير ${name} محليًا`);
  }
}
function bytesToBase64(bytes) {
  let binary=''; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
async function shareLastExport() {
  if (!lastExportUri) { toast('صدّر Excel أولًا'); return; }
  try {
    await Share.share({ title:'Sony time', text:'ملف الحضور والانصراف', files:[lastExportUri], dialogTitle:'مشاركة ملف Excel' });
  } catch (e) { if (e?.message !== 'Share canceled') toast('تعذر فتح المشاركة'); }
}

function rows(){
  const out=[];
  mine().forEach(s=>{const d=new Date(s.i);out.push({'التاريخ':d.toLocaleDateString('ar-EG',{day:'numeric',month:'numeric',year:'numeric'}),'اليوم':d.toLocaleDateString('ar-EG',{weekday:'long'}),'الحضور':tm(s.i),'الانصراف':s.o?tm(s.o):'لم ينصرف','المدة':dur(len(s)),'الساعات':hrs(len(s))});});
  return out;
}

$('bin').onclick=async()=>{if(open_())return;S.push({id:Date.now(),i:Date.now(),o:null});await writeData();render();toast('تم تسجيل الحضور');};
$('bout').onclick=async()=>{const s=open_();if(!s)return;s.o=Date.now();await writeData();render();toast('تم تسجيل الانصراف');};
$('prev').onclick=()=>{cur.setMonth(cur.getMonth()-1);render();};
$('next').onclick=()=>{cur.setMonth(cur.getMonth()+1);render();};
$('clr').onclick=async()=>{const n=mine().length;if(!n)return;if(confirm('مسح '+n+' سجل من هذا الشهر؟')){const ids=mine().map(s=>s.id);S=S.filter(s=>ids.indexOf(s.id)<0);await writeData();render();toast('تم مسح سجلات الشهر');}};
$('xl').onclick=()=>exportExcel().catch(()=>toast('تعذر التصدير'));
$('share').onclick=()=>shareLastExport();
$('restore').onclick=()=>{ $('restoreModal').classList.add('on'); };
$('cancelRestore').onclick=()=>$('restoreModal').classList.remove('on');
$('confirmRestore').onclick=async()=>{ $('restoreModal').classList.remove('on'); await restoreLatestBackup(); };

function render(){
  const s=open_(); $('bin').disabled=!!s; $('bout').disabled=!s;
  $('mname').textContent=cur.toLocaleDateString('ar-EG',{month:'long',year:'numeric'});
  const m=mine(),tot=m.reduce((a,x)=>a+len(x),0),dset={};
  m.forEach(x=>{dset[dk(x.i)]=(dset[dk(x.i)]||0)+len(x);});
  const nd=Object.keys(dset).length;
  $('tot').textContent=dur(tot)+' ('+hrs(tot)+' ساعة)'; $('days').textContent=nd.toLocaleString('ar-EG'); $('avg').textContent=nd?dur(tot/nd):'—';
  const L=$('log');
  if(!m.length){L.innerHTML='<div class="empty">لا توجد حركات في هذا الشهر.<br>اضغط «حضور» لتبدأ.</div>';tick();return;}
  const g={},order=[];
  m.forEach(x=>{const k=dk(x.i);if(!g[k]){g[k]=[];order.push(k);}g[k].push(x);}); order.reverse();
  L.innerHTML=order.map(k=>{const a=g[k],d=new Date(a[0].i);return '<div class="day"><div class="dh"><span>'+d.toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long'})+'</span><em>'+dur(dset[k])+'</em></div>'+a.map(x=>'<div class="se"><span class="t"><u>'+tm(x.i)+'</u> — <s>'+(x.o?tm(x.o):'مستمر')+'</s></span><span class="d">'+dur(len(x))+'</span><button class="del" data-id="'+x.id+'" aria-label="حذف">✕</button></div>').join('')+'</div>';}).join('');
  L.querySelectorAll('.del').forEach(b=>b.onclick=async()=>{const id=+b.dataset.id;S=S.filter(x=>x.id!==id);await writeData();render();toast('تم حذف الحركة');});
  tick();
}
function tick(){
  const d=new Date();$('clock').textContent=d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('date').textContent=d.toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const s=open_(); $('state').className='state'+(s?'':' off'); $('state').innerHTML=s?'<b>الحضور مسجل — العمل مستمر</b>':'الحالة: <b>غير مسجل حضور</b>';
}

(async()=>{
  S=await readData();
  const last=localStorage.getItem(LAST_EXPORT_KEY); if(last){lastExportUri=last;$('share').disabled=false;}
  render();
  await makeDailyBackup();
  setInterval(tick,1000);
})();
