const XLSX={};
let S=[];let cur=new Date();cur.setDate(1);const $=id=>document.getElementById(id);
const sampleXlsx='../tests/output/Sony-time-preview-2026-09.xlsx';
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1800)}
function dur(ms){const m=Math.round(ms/6e4),h=Math.floor(m/60);return h+'س '+(m%60)+'د'}
function hrs(ms){return Math.round(ms/36e5*100)/100}
function tm(ms){return new Date(ms).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}
function dk(ms){const d=new Date(ms);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
function open_(){return S.find(s=>s.o==null)} function len(s){return (s.o??Date.now())-s.i}
function inMonth(s){const d=new Date(s.i);return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth()}
function mine(){return S.filter(inMonth).sort((a,b)=>a.i-b.i)}
function save(){}
$('bin').onclick=()=>{if(open_())return;S.push({id:Date.now(),i:Date.now(),o:null});save();render();toast('تم تسجيل الحضور')}
$('bout').onclick=()=>{const s=open_();if(!s)return;s.o=Date.now();save();render();toast('تم تسجيل الانصراف')}
$('prev').onclick=()=>{cur.setMonth(cur.getMonth()-1);render()};$('next').onclick=()=>{cur.setMonth(cur.getMonth()+1);render()}
$('clr').onclick=()=>{S=[];save();render();toast('تم مسح سجلات الشهر')}
$('restore').onclick=()=>toast('في التطبيق الحقيقي: قراءة أحدث ملف من Documents/SonyTime/backup/')
$('cancelRestore').onclick=()=>$('restoreModal').classList.remove('on');$('confirmRestore').onclick=()=>{$('restoreModal').classList.remove('on');toast('تم الاسترجاع من النسخة الاحتياطية')}
$('xl').onclick=()=>{$('share').disabled=false;toast('تم حفظ Excel في Documents/SonyTime/exports/');}
$('share').onclick=()=>toast('فتح مشاركة ملف Excel')
function render(){const s=open_();$('bin').disabled=!!s;$('bout').disabled=!s;$('mname').textContent=cur.toLocaleDateString('ar-EG',{month:'long',year:'numeric'});const m=mine(),tot=m.reduce((a,x)=>a+len(x),0),dset={};m.forEach(x=>dset[dk(x.i)]=(dset[dk(x.i)]||0)+len(x));const nd=Object.keys(dset).length;$('tot').textContent=dur(tot)+' ('+hrs(tot)+' ساعة)';$('days').textContent=nd.toLocaleString('ar-EG');$('avg').textContent=nd?dur(tot/nd):'—';const L=$('log');if(!m.length){L.innerHTML='<div class="empty">لا توجد حركات في هذا الشهر.<br>اضغط «حضور» لتبدأ.</div>';return}const g={},order=[];m.forEach(x=>{const k=dk(x.i);if(!g[k]){g[k]=[];order.push(k)}g[k].push(x)});order.reverse();L.innerHTML=order.map(k=>{const a=g[k],d=new Date(a[0].i);return '<div class="day"><div class="dh"><span>'+d.toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long'})+'</span><em>'+dur(dset[k])+'</em></div>'+a.map(x=>'<div class="se"><span class="t"><u>'+tm(x.i)+'</u> — <s>'+(x.o?tm(x.o):'مستمر')+'</s></span><span class="d">'+dur(len(x))+'</span><button class="del" data-id="'+x.id+'">✕</button></div>').join('')+'</div>'}).join('');L.querySelectorAll('.del').forEach(b=>b.onclick=()=>{S=S.filter(x=>x.id!=+b.dataset.id);save();render();toast('تم حذف الحركة')});tick()}
function tick(){const d=new Date();$('clock').textContent=d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('date').textContent=d.toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long',year:'numeric'});const s=open_();$('state').className='state'+(s?'':' off');$('state').innerHTML=s?'<b>الحضور مسجل — العمل مستمر</b>':'الحالة: <b>غير مسجل حضور</b>'}
render();tick();setInterval(tick,1000)
