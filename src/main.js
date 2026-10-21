import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';
import { DataSafetyError, backupTimestamp, chooseUnusedName, classifyWriteReadback, createBackupEnvelope, parseBackup, persistSessions, readSessions, shouldTreatMissingAsFirstRun, shouldWriteToMissingPrimary, validateSessions, verifySnapshotReadback } from './data-safety.mjs';
import { isConfigured, isOnline, pushAllSessions, pullSessions } from './supabase.mjs';
import { createStoragePaths } from './storage-paths.mjs';

const TEST_BUILD = import.meta.env.VITE_SONYTIME_TEST_BUILD === 'true';
const {
  root: STORAGE_ROOT,
  dataPath: DATA_PATH,
  backupDir: BACKUP_DIR,
  recoveryDir: RECOVERY_DIR,
  exportDir: EXPORT_DIR,
  shareCacheDir: SHARE_CACHE_DIR,
  backupDatePath: BACKUP_DATE_PATH,
  localDataKey: LOCAL_DATA_KEY,
  backupMetaKey: BACKUP_META_KEY,
  lastExportKey: LAST_EXPORT_KEY,
  backupPrefix: BACKUP_PREFIX,
  safetyPrefix: SAFETY_PREFIX,
  corruptPrefix: CORRUPT_PREFIX,
} = createStoragePaths(TEST_BUILD);
const isNative = Capacitor.getPlatform() !== 'web';

let S = [];
let persistedData = [];
let dataReady = false;
let writeInProgress = false;
let loadError = null;
let primaryNeedsRecovery = false;
let primaryMustBeMissing = false;
let corruptOriginalRaw = null;
let cur = new Date();
cur.setDate(1);
let lastExportPath = null;
let lastExportWebUrl = null;
let safetySequence = 0;
let syncStatus = 'idle'; // idle | syncing | synced | error
let lastSyncAt = null;
let syncError = null;
let manualEntryOpen = false; // حالة modal الإدخال اليدوي

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
function dk(ms) {
  if (ms == null) return null;
  const d=new Date(ms); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}
function open_() { return S.find(s=>s.o==null && s.recordType==='auto'); }
function len(s) {
  // V2: سجل يدوي بالمدة فقط — لا يُحتسب كوردية مفتوحة، ولا تُختلق له أوقات.
  if (s.recordType==='manual' && s.manualDurationOnly && Number.isFinite(s.durationMinutes)) {
    return s.durationMinutes * 60 * 1000;
  }
  return (s.o==null?Date.now():s.o)-s.i;
}
function inMonth(s) {
  if (s.recordType === 'manual') {
    if (s.dateKey) {
      const d=new Date(s.dateKey+'T00:00:00');
      return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth();
    }
    if (s.i) {
      const d=new Date(s.i);
      return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth();
    }
    return false;
  }
  const d=new Date(s.i); return d.getFullYear()==cur.getFullYear()&&d.getMonth()==cur.getMonth();
}
function mine() { return S.filter(inMonth).sort((a,b)=>a.i-b.i); }
function todayKey() { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

async function nativeRead(path) {
  const r = await Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 });
  return typeof r.data === 'string' ? r.data : new TextDecoder().decode(r.data);
}
async function nativeWrite(path, text) {
  await Filesystem.writeFile({ path, directory: Directory.Documents, data: text, encoding: Encoding.UTF8, recursive: true });
}
function isMissingFile(error) {
  const code = String(error?.code ?? '');
  return ['FILE_NOT_FOUND', 'ENOENT', 'OS-PLUG-FILE-0008'].includes(code) || /(?:file|path).*(?:does not exist|not found)|no such file/i.test(String(error?.message ?? ''));
}
async function nativeExists(path) {
  try { await Filesystem.stat({ path, directory: Directory.Documents }); return true; }
  catch (error) { if (isMissingFile(error)) return false; throw error; }
}
async function ensureShareCacheDirectory() {
  try {
    const info = await Filesystem.stat({ path: SHARE_CACHE_DIR, directory: Directory.Cache });
    if (info.type !== 'directory') throw new Error('مسار المشاركة المؤقت ليس مجلدًا.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    await Filesystem.mkdir({ path: SHARE_CACHE_DIR, directory: Directory.Cache, recursive: true });
  }
}
function cloneData(value) { return JSON.parse(JSON.stringify(value)); }
function currentDataStateSignature() {
  return JSON.stringify({
    error: loadError?.code ?? null,
    needsRecovery: primaryNeedsRecovery,
    mustBeMissing: primaryMustBeMissing,
    persistedData,
    corruptOriginalRaw,
  });
}
function fileStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function uniqueSuffix() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${safetySequence++}`;
}

async function readData() {
  return readSessions(async () => {
    if (isNative) {
      const info = await Filesystem.stat({ path: DATA_PATH, directory: Directory.Documents });
      if (info.size > 10 * 1024 * 1024) {
        throw new DataSafetyError('READ_FAILED', 'ملف الحضور أكبر من 10 ميجابايت؛ تم إيقاف القراءة والحفظ لحماية البيانات.');
      }
      return nativeRead(DATA_PATH);
    }
    const raw = localStorage.getItem(LOCAL_DATA_KEY);
    if (raw === null) throw Object.assign(new Error('data file missing'), { code: 'FILE_NOT_FOUND' });
    return raw;
  });
}

async function writeSafetySnapshot(raw) {
  parseBackup(raw);
  if (isNative) {
    const path = await chooseUnusedName(
      () => `${BACKUP_DIR}/safety-${fileStamp()}-${uniqueSuffix()}.json`,
      nativeExists,
    );
    await nativeWrite(path, raw);
    verifySnapshotReadback(raw, await nativeRead(path));
  } else {
    const key = await chooseUnusedName(
      () => `${SAFETY_PREFIX}${Date.now()}.${uniqueSuffix()}`,
      async candidate => localStorage.getItem(candidate) !== null,
    );
    localStorage.setItem(key, raw);
    verifySnapshotReadback(raw, localStorage.getItem(key));
  }
}

async function writeData(nextData = S, { recover = false, requireMissingPrimary = primaryMustBeMissing } = {}) {
  if (!dataReady && !recover) throw new Error('البيانات غير جاهزة للكتابة.');
  const previous = dataReady || ['WRITE_FAILED', 'CORRUPT_DATA', 'READ_FAILED'].includes(loadError?.code) ? persistedData : [];
  await persistSessions(nextData, previous, {
    writeSafety: writeSafetySnapshot,
    writeMain: async raw => {
      if (requireMissingPrimary) {
        const currentExists = isNative
          ? await nativeExists(DATA_PATH)
          : localStorage.getItem(LOCAL_DATA_KEY) !== null;
        if (!shouldWriteToMissingPrimary(true, currentExists)) {
          throw new DataSafetyError('WRITE_FAILED', 'ظهر ملف بيانات جديد؛ تم إيقاف الاستعادة حتى لا يتم استبداله.');
        }
      }
      if (isNative) await nativeWrite(DATA_PATH, raw);
      else localStorage.setItem(LOCAL_DATA_KEY, raw);
    },
    readMain: async () => {
      if (isNative) return nativeRead(DATA_PATH);
      const raw = localStorage.getItem(LOCAL_DATA_KEY);
      if (raw === null) throw new Error('Saved data disappeared during verification');
      return raw;
    },
  });
  S = cloneData(nextData);
  persistedData = cloneData(nextData);
  dataReady = true;
  loadError = null;
  primaryNeedsRecovery = false;
  primaryMustBeMissing = false;
  corruptOriginalRaw = null;
  render();
  setStorageControls();
  await makeDailyBackup();
}

async function makeDailyBackup() {
  if (!dataReady || !S.length || !validateSessions(S).valid) return;
  const key = todayKey();
  try {
    const entries = (await listBackups()).filter(entry => entry.name.startsWith(isNative ? `data-${key}` : `${BACKUP_PREFIX}${key}`));
    for (const entry of entries) {
      try {
        const raw = isNative ? await nativeRead(`${BACKUP_DIR}/${entry.name}`) : localStorage.getItem(entry.key);
        const existing = parseBackup(raw);
        if (JSON.stringify(existing.data) === JSON.stringify(S)) {
          if (isNative) await nativeWrite(BACKUP_DATE_PATH, key);
          else localStorage.setItem(BACKUP_META_KEY, key);
          $('storageStatus').textContent = `نسخة اليوم محفوظة — ${key}`;
          return;
        }
      } catch (error) {
        if (error?.code !== 'INVALID_BACKUP' && error?.code !== 'CORRUPT_DATA') throw error;
        // Keep invalid and older snapshots untouched.
      }
    }

    if (isNative) {
      const path = await chooseUnusedName(
        () => `${BACKUP_DIR}/data-${key}T${fileStamp()}-${uniqueSuffix()}.json`,
        nativeExists,
      );
      const payload = createBackupEnvelope(S);
      await nativeWrite(path, payload);
      verifySnapshotReadback(payload, await nativeRead(path));
      await nativeWrite(BACKUP_DATE_PATH, key);
    } else {
      const dailyKey = `${BACKUP_PREFIX}${key}`;
      const target = await chooseUnusedName(
        () => `${dailyKey}.${Date.now()}.${uniqueSuffix()}`,
        async candidate => localStorage.getItem(candidate) !== null,
      );
      const payload = createBackupEnvelope(S);
      localStorage.setItem(target, payload);
      verifySnapshotReadback(payload, localStorage.getItem(target));
      localStorage.setItem(BACKUP_META_KEY, key);
    }
    $('storageStatus').textContent = `نسخة اليوم محفوظة — ${key}`;
  } catch {
    $('storageStatus').textContent = 'تعذّر إنشاء نسخة اليوم؛ بيانات الحضور الأصلية لم تُمس.';
  }
}

/* ===== Cloud Sync (Supabase) ===== */
async function syncToCloud() {
  if (!isConfigured() || !isOnline() || !dataReady) return { ok: false, skipped: true };
  syncStatus = 'syncing';
  render();
  try {
    const result = await pushAllSessions(S);
    if (result.ok) {
      syncStatus = 'synced';
      lastSyncAt = new Date();
      syncError = null;
    } else {
      syncStatus = 'error';
      syncError = result.errors?.join(', ') || 'فشل الرفع للسحابة';
    }
    render();
    return result;
  } catch (err) {
    syncStatus = 'error';
    syncError = err?.message || String(err);
    render();
    return { ok: false, error: syncError };
  }
}

async function syncFromCloud() {
  if (!isConfigured() || !isOnline()) return { ok: false, skipped: true };
  syncStatus = 'syncing';
  render();
  try {
    const result = await pullSessions();
    if (result.ok && result.sessions.length > 0) {
      const cloud = result.sessions;
      const localIds = new Set(S.map(s => s.id));
      const merged = [...S];
      let added = 0;
      for (const c of cloud) {
        if (!localIds.has(c.id)) {
          merged.push(c);
          added += 1;
        }
      }
      if (added > 0) {
        await commitData(merged);
      }
      syncStatus = 'synced';
      lastSyncAt = new Date();
      syncError = null;
    } else {
      syncStatus = 'synced';
      lastSyncAt = new Date();
      syncError = null;
    }
    render();
    return result;
  } catch (err) {
    syncStatus = 'error';
    syncError = err?.message || String(err);
    render();
    return { ok: false, error: syncError };
  }
}

async function autoSync() {
  if (!isConfigured() || !isOnline()) return;
  await syncFromCloud();
  await syncToCloud();
}
/* ===== End Cloud Sync ===== */

/* ===== Manual history entry (V2) ===== */
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtMsInput(ms) {
  const d = new Date(ms);
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+'T'+pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function parseMsInput(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function hasManualOnDay(targetDayStart) {
  const targetKey = new Date(targetDayStart).toISOString().slice(0,10);
  return S.some(s => s.recordType==='manual' && (s.dateKey === targetKey || (s.i && dayStart(s.i) === targetDayStart)));
}
function sessionOverlapsExisting(newI, newO, excludeId) {
  return S.some(s => {
    if (s.id === excludeId) return false;
    // سجل يدوي بالمدة فقط لا 가진 أوقات، لا يُمكن أن يتداخل.
    if (s.recordType==='manual' && s.manualDurationOnly) return false;
    const aStart = s.i, aEnd = s.o === null ? Date.now() : s.o;
    const bStart = newI, bEnd = newO === null ? Date.now() : newO;
    return bStart < aEnd && aStart < bEnd;
  });
}

/**
 * أضف سجل يدوي ليوم سابق.
 * targetDayStart: بداية اليوم بالتوقيت المحلي (ms)
 * checkInMs, checkOutMs: أوقات محددة أو null
 * durationMinutes: المدة بالدقائق إذا لم يتم specifying أوقات (المدة فقط، لا تُختلق أوقات)
 * note: ملاحظات اختيارية
 * returns { ok, error, session }
 */
async function addManualSession(targetDayStart, checkInMs, checkOutMs, durationMinutes, note) {
  if (!dataReady) return { ok: false, error: 'البيانات غير جاهزة.' };
  let i, o, manualDurationOnly = false;
  if (checkInMs !== null && checkOutMs !== null) {
    i = checkInMs;
    o = checkOutMs;
    if (o <= i) return { ok: false, error: 'وقت الانصراف يجب أن يكون بعد وقت الحضور.' };
  } else if (durationMinutes !== null && durationMinutes > 0) {
    // مدة فقط: لا نبتكر أوقات حضور أو انصراف، نُخزّن المدة مباشرة.
    i = null;
    o = null;
    manualDurationOnly = true;
  } else {
    return { ok: false, error: 'يجب تحديد وقت الحضور والانصراف أو المدة.' };
  }
  if (hasManualOnDay(targetDayStart)) {
    return { ok: false, error: 'يوجد سجل يدوي لهذا اليوم بالفعل. لا يمكن تكرار الإدخال اليدوي ليوم واحد.' };
  }
  if (i !== null && o !== null && sessionOverlapsExisting(i, o, null)) {
    return { ok: false, error: 'هذا السجل يتداخل مع سجل موجود.' };
  }
  const now = Date.now();
  const dayKey = new Date(targetDayStart).toISOString().slice(0,10);
  const session = { id: now, i, o, recordType: 'manual', manualDurationOnly, durationMinutes: manualDurationOnly ? durationMinutes : null, note: note || null, dateKey };
  const next = [...S, session];
  if (await commitData(next)) {
    toast('تم إضافة السجل اليدوي.');
    return { ok: true, session };
  }
  return { ok: false, error: 'فشل حفظ السجل اليدوي.' };
}

/**
 * عدل سجلاً موجوداً.
 * updates: كائن يحتوي على أي من: i, o, note, manualDurationOnly, durationMinutes, recordType
 */
async function editSession(id, updates) {
  if (!dataReady) return { ok: false, error: 'البيانات غير جاهزة.' };
  const idx = S.findIndex(s => s.id === id);
  if (idx === -1) return { ok: false, error: 'السجل غير موجود.' };
  const next = S.map(s => {
    if (s.id !== id) return s;
    return { ...s, ...updates };
  });
  const modified = next[idx];
  // التحقق من صلاحية السجل بعد التعديل
  if (modified.recordType !== 'manual' && modified.o !== null && modified.o <= modified.i) {
    return { ok: false, error: 'وقت الانصراف يجب أن يكون بعد وقت الحضور.' };
  }
  if (modified.recordType === 'manual' && modified.manualDurationOnly && modified.i !== null) {
    return { ok: false, error: 'السجل اليدوي بالمدة فقط لا يجب أن يحتوي على أوقات.' };
  }
  if (modified.i !== null && modified.o !== null && sessionOverlapsExisting(modified.i, modified.o, id)) {
    return { ok: false, error: 'التعديل يتسبب في تداخل مع سجل موجود.' };
  }
  if (await commitData(next)) {
    toast('تم تعديل السجل.');
    return { ok: true };
  }
  return { ok: false, error: 'فشل تعديل السجل.' };
}
/* ===== End Manual history entry ===== */

async function listBackups() {
  if (!isNative) {
    return Object.keys(localStorage)
      .filter(key => key.startsWith(BACKUP_PREFIX) || key.startsWith(SAFETY_PREFIX))
      .map(key => ({ name: key, key }))
      .sort((a, b) => Number(a.key.startsWith(SAFETY_PREFIX)) - Number(b.key.startsWith(SAFETY_PREFIX)) || b.name.localeCompare(a.name));
  }
  try {
    const result = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents });
    return result.files.filter(file => file.name.endsWith('.json')).sort((a, b) => Number(a.name.startsWith('safety-')) - Number(b.name.startsWith('safety-')) || b.name.localeCompare(a.name));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

async function retryDataRead() {
  const previousError = loadError;
  try {
    const loaded = await readData();
    const missingIsFirstRun = shouldTreatMissingAsFirstRun({
      primaryNeedsRecovery,
      previousErrorCode: previousError?.code,
      knownRecords: persistedData.length,
    });
    if (loaded.status === 'missing' && !missingIsFirstRun) {
      let stillMissing;
      try {
        stillMissing = isNative
          ? !await nativeExists(DATA_PATH)
          : localStorage.getItem(LOCAL_DATA_KEY) === null;
      } catch (error) {
        loadError = new DataSafetyError('READ_FAILED', 'تعذّر تأكيد غياب ملف البيانات؛ لن يتم استبداله.', error);
        primaryNeedsRecovery = true;
        primaryMustBeMissing = false;
        dataReady = false;
        S = cloneData(persistedData);
        $('storageStatus').textContent = loadError.message;
        render();
        setStorageControls();
        return false;
      }
      if (!stillMissing) {
        loadError = new DataSafetyError('READ_FAILED', 'ظهر ملف بيانات أثناء محاولة الاستعادة؛ أعد القراءة قبل أي استبدال.');
        primaryNeedsRecovery = true;
        primaryMustBeMissing = false;
        dataReady = false;
        S = cloneData(persistedData);
        $('storageStatus').textContent = loadError.message;
        render();
        setStorageControls();
        return false;
      }
      primaryNeedsRecovery = true;
      primaryMustBeMissing = true;
      dataReady = false;
      loadError = previousError?.code === 'CORRUPT_DATA'
        ? previousError
        : Object.assign(new Error('ملف البيانات غير موجود بعد تعذر التحقق منه؛ يلزم استعادة نسخة سليمة.'), { code: 'WRITE_FAILED' });
      S = cloneData(persistedData);
      $('storageStatus').textContent = 'تم تأكيد غياب الملف؛ أوقفنا التعديل العادي ونشترط بقاءه غائبًا لحظة الاستعادة.';
      render();
      setStorageControls();
      return true;
    }
    S = loaded.data;
    persistedData = cloneData(loaded.data);
    dataReady = true;
    loadError = null;
    primaryNeedsRecovery = false;
    primaryMustBeMissing = loaded.status === 'missing';
    corruptOriginalRaw = null;
    render();
    setStorageControls();
    return true;
  } catch (error) {
    loadError = error;
    primaryNeedsRecovery = true;
    primaryMustBeMissing = false;
    corruptOriginalRaw = error?.code === 'CORRUPT_DATA' ? error.raw ?? null : null;
    dataReady = false;
    $('storageStatus').textContent = error?.message || 'تعذّرت إعادة قراءة ملف البيانات.';
    render();
    setStorageControls();
    return error?.code === 'CORRUPT_DATA';
  }
}

async function restoreLatestBackup() {
  if (!await retryDataRead() && !['CORRUPT_DATA', 'WRITE_FAILED'].includes(loadError?.code)) return;
  try {
    const candidates = await listBackups();
    const valid = [];
    for (const candidate of candidates) {
      try {
        const raw = isNative ? await nativeRead(`${BACKUP_DIR}/${candidate.name}`) : localStorage.getItem(candidate.key);
        const backup = parseBackup(raw);
        valid.push({
          name: candidate.name,
          ...backup,
          timestamp: backupTimestamp(candidate.name || candidate.key, backup.exportedAt),
        });
      } catch { /* Skip invalid backups without changing any stored file. */ }
    }
    valid.sort((a, b) => b.timestamp - a.timestamp || b.name.localeCompare(a.name));
    const selected = valid[0];
    if (!selected) { toast('لا توجد نسخة احتياطية سليمة للاسترجاع'); return; }
    let protection;
    if (corruptOriginalRaw !== null) {
      protection = `سيتم حفظ الملف التالف الأصلي${persistedData.length ? ` ونسخة أمان من ${persistedData.length} سجل صالح معروف` : ''} قبل الاستبدال`;
    } else if (persistedData.length > 0) {
      protection = `سيتم حفظ نسخة أمان من الحالة الحالية (${persistedData.length} سجل)`;
    } else {
      protection = 'لا توجد سجلات سابقة معروفة لحفظها';
    }
    const stateAtPrompt = currentDataStateSignature();
    if (!confirm(`النسخة الأحدث تحتوي على ${selected.data.length} سجل. ${protection}. هل تريد المتابعة؟`)) return;
    if (!await retryDataRead() && !['CORRUPT_DATA', 'WRITE_FAILED'].includes(loadError?.code)) return;
    if (currentDataStateSignature() !== stateAtPrompt &&
        !confirm('تغيّرت حالة التخزين بعد التأكيد الأول. سيتم حفظ الحالة السليمة المقروءة أو الملف التالف الأصلي قبل الاستبدال. تأكيد نهائي؟')) return;
    await preserveCorruptOriginal();
    if (!await commitData(selected.data, { recover: !dataReady, requireMissingPrimary: primaryMustBeMissing })) return;
    toast(`تم الاسترجاع من ${selected.name}`);
  } catch (error) {
    $('storageStatus').textContent = error?.message || 'تعذّر استرجاع النسخة الاحتياطية.';
  }
}

async function preserveCorruptOriginal() {
  if (corruptOriginalRaw === null) return;
  if (isNative) {
    const path = await chooseUnusedName(
      () => `${RECOVERY_DIR}/data-corrupt-${fileStamp()}-${uniqueSuffix()}.json`,
      nativeExists,
    );
    await nativeWrite(path, corruptOriginalRaw);
    if (await nativeRead(path) !== corruptOriginalRaw) throw new Error('تعذّر التحقق من حفظ الملف التالف الأصلي.');
  } else {
    const key = await chooseUnusedName(
      () => `${CORRUPT_PREFIX}${Date.now()}.${uniqueSuffix()}`,
      async candidate => localStorage.getItem(candidate) !== null,
    );
    localStorage.setItem(key, corruptOriginalRaw);
    if (localStorage.getItem(key) !== corruptOriginalRaw) throw new Error('تعذّر حفظ الملف التالف الأصلي.');
  }
}

async function readPickedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('تعذّرت قراءة الملف المختار.'));
    reader.readAsText(file);
  });
}

async function importBackupFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size > 10 * 1024 * 1024) {
    $('storageStatus').textContent = 'حجم ملف النسخة يجب ألا يتجاوز 10 ميجابايت.';
    return;
  }
  let imported;
  try { imported = parseBackup(await readPickedFile(file)); }
  catch (error) { $('storageStatus').textContent = error?.message || 'النسخة الاحتياطية غير صالحة.'; return; }
  if (!await retryDataRead() && !['CORRUPT_DATA', 'WRITE_FAILED'].includes(loadError?.code)) {
    $('storageStatus').textContent = 'تعذّرت قراءة الحالة الحالية؛ لن نكتب فوقها. أعد المحاولة بعد استعادة الوصول إلى التخزين.';
    return;
  }
  if (!dataReady && !['CORRUPT_DATA', 'WRITE_FAILED'].includes(loadError?.code)) {
    $('storageStatus').textContent = 'تعذّرت قراءة بيانات التطبيق؛ لن أستبدلها قبل التأكد من سلامة التخزين.';
    return;
  }
  let protection;
  if (corruptOriginalRaw !== null) {
    protection = `سيتم حفظ الملف التالف الأصلي${persistedData.length ? ` ونسخة أمان من ${persistedData.length} سجل صالح معروف` : ''} قبل الاستبدال`;
  } else if (persistedData.length > 0) {
    protection = `سيتم حفظ نسخة أمان من الحالة الحالية (${persistedData.length} سجل)`;
  } else {
    protection = 'لا توجد سجلات سابقة معروفة لحفظها';
  }
  const stateAtPrompt = currentDataStateSignature();
  if (!confirm(`تم التحقق من النسخة: ${imported.data.length} سجل. ${protection}. متابعة؟`)) return;
  if (!await retryDataRead() && !['CORRUPT_DATA', 'WRITE_FAILED'].includes(loadError?.code)) return;
  if (currentDataStateSignature() !== stateAtPrompt &&
      !confirm('تغيّرت حالة التخزين بعد التأكيد الأول. سيتم حفظ الحالة السليمة المقروءة أو الملف التالف الأصلي قبل الاستبدال. تأكيد نهائي؟')) return;
  try {
    await preserveCorruptOriginal();
    if (!await commitData(imported.data, { recover: !dataReady, requireMissingPrimary: primaryMustBeMissing })) return;
    toast('تم التحقق من النسخة واستيرادها بنجاح');
  } catch (error) {
    $('storageStatus').textContent = error?.message || 'تعذّر استيراد النسخة؛ لم يتم تأكيد الحفظ.';
  }
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
    lastExportPath = path;
    localStorage.setItem(LAST_EXPORT_KEY, lastExportPath);
    $('share').disabled=false;
    toast(`تم حفظ Excel في Documents/${STORAGE_ROOT}/exports/${name}`);
  } else {
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
    lastExportWebUrl=url;
    $('share').disabled=false;
    toast(`تم تصدير ${name} محليًا`);
  }
}
function bytesToBase64(bytes) {
  let binary=''; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
async function exportBackup() {
  if (!dataReady) { toast('بيانات التطبيق غير جاهزة للتصدير'); return; }
  const payload = createBackupEnvelope(S);
  let name = `Sony-time-backup-${todayKey()}-${Date.now()}-${safetySequence++}.json`;
  if (isNative) {
    let path = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      name = `Sony-time-backup-${todayKey()}-${Date.now()}-${safetySequence++}.json`;
      const candidate = `${EXPORT_DIR}/${name}`;
      if (!await nativeExists(candidate)) { path = candidate; break; }
    }
    if (!path) throw new Error('تعذّر إنشاء اسم فريد لملف النسخة الاحتياطية.');
    await nativeWrite(path, payload);
    parseBackup(await nativeRead(path));
    const cachePath = `${SHARE_CACHE_DIR}/${name}`;
    await ensureShareCacheDirectory();
    await Filesystem.copy({ from: path, to: cachePath, directory: Directory.Documents, toDirectory: Directory.Cache });
    const uri = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
    try {
      await Share.share({
        title: 'نسخة Sony Time الاحتياطية',
        text: 'اختر Files أو Drive لحفظ النسخة في المكان الذي تريده.',
        files: [uri.uri],
        dialogTitle: 'حفظ نسخة Sony Time',
      });
      toast('تم فتح قائمة المشاركة لحفظ النسخة');
    } catch (error) {
      if (error?.message !== 'Share canceled') $('storageStatus').textContent = `تم إنشاء النسخة داخل Documents/${STORAGE_ROOT}/exports لكن تعذرت مشاركة الملف.`;
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('تم تنزيل النسخة الاحتياطية؛ اختر مكان حفظها من المتصفح');
}
async function shareLastExport() {
  try {
    let shareUri;
    if (isNative) {
      if (!lastExportPath) { toast('صدّر Excel أولًا'); return; }
      const name = lastExportPath.split('/').pop();
      const cachePath = `${SHARE_CACHE_DIR}/share-${Date.now()}-${safetySequence++}-${name}`;
      await ensureShareCacheDirectory();
      await Filesystem.copy({ from: lastExportPath, to: cachePath, directory: Directory.Documents, toDirectory: Directory.Cache });
      shareUri = (await Filesystem.getUri({ path: cachePath, directory: Directory.Cache })).uri;
    } else {
      if (!lastExportWebUrl) { toast('صدّر Excel أولًا'); return; }
      shareUri = lastExportWebUrl;
    }
    await Share.share({ title:'Sony time', text:'ملف الحضور والانصراف', files:[shareUri], dialogTitle:'مشاركة ملف Excel' });
  } catch (error) {
    if (error?.message !== 'Share canceled') toast('تعذر فتح المشاركة');
  }
}

function rows(){
  const out=[];
  mine().forEach(s=>{
    const d=new Date(s.i);
    const isManual = s.recordType==='manual';
    const noteText = s.note ? ' — ملاحظة: '+s.note : '';
    const isDurationOnly = isManual && s.manualDurationOnly;
    const checkIn = s.i ? tm(s.i) : '—';
    const checkOut = s.o ? tm(s.o) : '—';
    const openStatus = s.recordType==='auto' && s.o ? 'تم' : (s.recordType==='auto' ? 'مفتوح' : 'مكتمل');
    out.push({
      'التاريخ':d.toLocaleDateString('ar-EG',{day:'numeric',month:'numeric',year:'numeric'}),
      'اليوم':d.toLocaleDateString('ar-EG',{weekday:'long'}),
      'الحضور':checkIn,
      'الانصراف':checkOut,
      'النوع':isManual?'يدوي':'تلقائي',
      'المدة':dur(len(s)),
      'الساعات':hrs(len(s)),
      'الحالة':openStatus,
      'ملاحظات':s.note||'',
      'ملاحظات显示':s.note?'✓':'—',
      'id':s.id,
      'recordType':s.recordType,
      'manualDurationOnly':s.manualDurationOnly||false
    });
  });
  return out;
}

function setStorageControls() {
  const canRecover = ['CORRUPT_DATA', 'WRITE_FAILED', 'READ_FAILED'].includes(loadError?.code);
  const locked = !dataReady || writeInProgress;
  $('bin').disabled = locked || !!open_();
  $('bout').disabled = locked || !open_();
  $('clr').disabled = locked;
  $('xl').disabled = locked;
  $('exportBackup').disabled = locked;
  $('importBackup').disabled = writeInProgress || (!dataReady && !canRecover);
  $('restore').disabled = writeInProgress || (!dataReady && !canRecover);
  // حالة المزامنة مع السحابة
  const syncBtn = $('syncNow');
  const syncStatusEl = $('syncStatus');
  if (syncBtn && syncStatusEl) {
    if (!isConfigured()) {
      syncBtn.disabled = true;
      syncStatusEl.textContent = 'السحابة: غير مضبوط (أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY)';
      syncStatusEl.style.color = '#ffb3ba';
    } else if (!isOnline()) {
      syncBtn.disabled = true;
      syncStatusEl.textContent = 'السحابة: غير متصل بالإنترنت';
      syncStatusEl.style.color = '#ffd166';
    } else if (syncStatus === 'syncing') {
      syncBtn.disabled = true;
      syncStatusEl.textContent = 'السحابة: جاري المزامنة…';
      syncStatusEl.style.color = '#bae8e8';
    } else if (syncStatus === 'synced') {
      syncBtn.disabled = false;
      const t = lastSyncAt ? lastSyncAt.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}) : '';
      syncStatusEl.textContent = `السحابة: مزامن${t ? ' آخر مرة في '+t : ''}`;
      syncStatusEl.style.color = '#baffc9';
    } else if (syncStatus === 'error') {
      syncBtn.disabled = false;
      syncStatusEl.textContent = `السحابة: خطأ — ${syncError || ''}`;
      syncStatusEl.style.color = '#ffb3ba';
    } else {
      syncBtn.disabled = false;
      syncStatusEl.textContent = 'السحابة: في انتظار المزامنة';
      syncStatusEl.style.color = '#bae8e8';
    }
  }
}

async function commitData(nextData, options = {}) {
  if (writeInProgress) return false;
  writeInProgress = true;
  setStorageControls();
  try {
    await writeData(nextData, options);
    await syncToCloud();
    return true;
  } catch (writeError) {
    primaryNeedsRecovery = true;
    primaryMustBeMissing = false;
    let observed;
    try {
      observed = await readData();
    } catch (readError) {
      loadError = readError;
      corruptOriginalRaw = readError?.code === 'CORRUPT_DATA' ? readError.raw ?? null : null;
      dataReady = false;
      S = cloneData(persistedData);
      $('storageStatus').textContent = readError?.message || writeError?.message || 'تعذّر التحقق من حالة ملف البيانات.';
      render();
      return false;
    }

    const readbackState = classifyWriteReadback(observed, nextData, persistedData);
    if (readbackState === 'missing') {
      primaryMustBeMissing = true;
      loadError = writeError;
      dataReady = false;
      S = cloneData(persistedData);
      $('storageStatus').textContent = persistedData.length > 0
        ? 'ملف البيانات غير موجود بعد فشل الحفظ؛ احتفظنا بآخر سجلات مقروءة وأوقفنا التعديلات حتى الاستعادة.'
        : 'لم يتم تأكيد الحفظ وملف البيانات غير موجود؛ أوقفنا التعديلات. استعد نسخة سليمة أو استورد نسخة احتياطية.';
      render();
      return false;
    }

    const observedData = observed.data;
    const matchesAttempt = readbackState === 'attempted';
    const matchesPrevious = readbackState === 'previous';
    S = cloneData(observedData);
    persistedData = cloneData(observedData);
    if (matchesAttempt || matchesPrevious) {
      dataReady = true;
      loadError = null;
      primaryNeedsRecovery = false;
      primaryMustBeMissing = false;
      $('storageStatus').textContent = matchesAttempt
        ? 'تم حفظ البيانات والتحقق منها بإعادة القراءة.'
        : 'لم يثبت التعديل؛ تم الإبقاء على آخر نسخة مقروءة سليمة.';
      render();
      return matchesAttempt;
    }

    loadError = writeError;
    dataReady = false;
    $('storageStatus').textContent = 'تغيّر ملف البيانات أثناء الحفظ؛ أُوقفت التعديلات حتى استعادة نسخة سليمة.';
    render();
    return false;
  } finally {
    writeInProgress = false;
    setStorageControls();
  }
}

$('bin').onclick=async()=>{if(!dataReady||open_())return;const now=Date.now();if(await commitData([...S,{id:now,i:now,o:null,recordType:'auto'}]))toast('تم تسجيل الحضور');};
$('bout').onclick=async()=>{if(!dataReady)return;const s=open_();if(!s)return;const now=Date.now();const next=S.map(item=>item===s?{...item,o:now}:item);if(await commitData(next))toast('تم تسجيل الانصراف');};
$('prev').onclick=()=>{cur.setMonth(cur.getMonth()-1);render();};
$('next').onclick=()=>{cur.setMonth(cur.getMonth()+1);render();};
$('clr').onclick=async()=>{if(!dataReady)return;const n=mine().length;if(!n)return;if(confirm('مسح '+n+' سجل من هذا الشهر؟')){const ids=mine().map(s=>s.id);if(await commitData(S.filter(x=>!ids.includes(x.id))))toast('تم مسح سجلات الشهر');}};
$('xl').onclick=()=>exportExcel().catch(error=>$('storageStatus').textContent=error?.message||'تعذر التصدير');
$('share').onclick=()=>shareLastExport();
$('exportBackup').onclick=()=>exportBackup().catch(error=>$('storageStatus').textContent=error?.message||'تعذّر تصدير النسخة الاحتياطية.');
$('importBackup').onclick=()=>$('backupFile').click();
$('backupFile').onchange=async event=>{const file=event.target.files?.[0];if(file)await importBackupFile(file);event.target.value='';};
$('restore').onclick=()=>{ $('restoreModal').classList.add('on'); };
$('cancelRestore').onclick=()=>$('restoreModal').classList.remove('on');
$('confirmRestore').onclick=async()=>{ $('restoreModal').classList.remove('on'); await restoreLatestBackup(); };
$('syncNow').onclick=async()=>{ await autoSync(); };

let manualEntryInProgress = false;
$('manualEntry').onclick=async()=>{
  if (!dataReady) { toast('البيانات غير جاهزة.'); return; }
  if (manualEntryInProgress) return;
  manualEntryInProgress = true;
  const d = new Date();
  $('manualDate').valueAsDate = d;
  $('manualMode').value = 'duration';
  $('manualHours').value = '0';
  $('manualMinutes').value = '0';
  $('manualCheckIn').value = '';
  $('manualCheckOut').value = '';
  $('manualNote').value = '';
  $('manualResult').textContent = '';
  $('manualDurationFields').style.display = 'flex';
  $('manualTimeFields').style.display = 'none';
  $('manualEntryModal').classList.add('on');
};
$('manualCancel').onclick=()=>{
  manualEntryInProgress = false;
  $('manualEntryModal').classList.remove('on');
  $('manualResult').textContent = '';
};
$('manualMode').onchange=()=>{
  const isDuration = $('manualMode').value === 'duration';
  $('manualDurationFields').style.display = isDuration ? 'flex' : 'none';
  $('manualTimeFields').style.display = isDuration ? 'none' : 'flex';
};
$('manualConfirm').onclick=async()=>{
  if (manualEntryInProgress !== true) return;
  const dateStr = $('manualDate').value;
  if (!dateStr) { $('manualResult').textContent = 'يرجى اختيار التاريخ.'; return; }
  const mode = $('manualMode').value;
  const note = $('manualNote').value || null;

  let checkInMs = null, checkOutMs = null, durationMinutes = null;
  if (mode === 'duration') {
    const h = Number($('manualHours').value) || 0;
    const m = Number($('manualMinutes').value) || 0;
    durationMinutes = h * 60 + m;
    if (durationMinutes <= 0) { $('manualResult').textContent = 'المدة يجب أن تكون أكبر من صفر.'; return; }
  } else {
    const ci = $('manualCheckIn').value;
    const co = $('manualCheckOut').value;
    if (!ci || !co) { $('manualResult').textContent = 'يرجى إدخال وقت الحضور والانصراف.'; return; }
    checkInMs = new Date(dateStr + 'T' + ci).getTime();
    checkOutMs = new Date(dateStr + 'T' + co).getTime();
    if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs)) { $('manualResult').textContent = 'وقت غير صالح.'; return; }
    if (checkOutMs <= checkInMs) { $('manualResult').textContent = 'وقت الانصراف يجب أن يكون بعد وقت الحضور.'; return; }
    const targetStart = new Date(dateStr + 'T00:00:00').getTime();
    if (sessionOverlapsExisting(checkInMs, checkOutMs, null)) { $('manualResult').textContent = 'هذا الوقت يتداخل مع سجل موجود.'; return; }
  }
  const targetStart = new Date(dateStr + 'T00:00:00').getTime();
  if (hasManualOnDay(targetStart)) { $('manualResult').textContent = 'يوجد سجل يدوي لهذا اليوم بالفعل.'; return; }

  manualEntryInProgress = false;
  const result = await addManualSession(targetStart, checkInMs, checkOutMs, durationMinutes, note);
  if (result.ok) {
    $('manualEntryModal').classList.remove('on');
    $('manualResult').textContent = '';
    render();
    setStorageControls();
    toast('تم إضافة السجل اليدوي.');
  } else {
    manualEntryInProgress = true;
    $('manualResult').textContent = result.error || 'فشل حفظ السجل.';
  }
};

setStorageControls();

function firstDateKeyOf(records) {
  for (let r of records) {
    if (r.dateKey) return r.dateKey;
    if (r.i) return dk(r.i);
  }
  return null;
}
function dateKeyOf(s) {
  if (s.recordType === 'manual' && s.dateKey) return s.dateKey;
  if (s.i) return dk(s.i);
  return null;
}
function render(){
  const s=dataReady?open_():null; $('bin').disabled=!dataReady||!!s; $('bout').disabled=!dataReady||!s;
  $('mname').textContent=cur.toLocaleDateString('ar-EG',{month:'long',year:'numeric'});
  const m=dataReady?mine():[],tot=m.reduce((a,x)=>a+len(x),0),dset={};
  m.forEach(x=>{const k=dateKeyOf(x);if(k)dset[k]=(dset[k]||0)+len(x);});
  const nd=Object.keys(dset).length;
  $('tot').textContent=dur(tot)+' ('+hrs(tot)+' ساعة)'; $('days').textContent=nd.toLocaleString('ar-EG'); $('avg').textContent=nd?dur(tot/nd):'—';
  const L=$('log');
  if(!dataReady){
    const message = loadError?.code === 'CORRUPT_DATA'
      ? 'ملف البيانات الأصلي لم يتم تغييره. استورد نسخة احتياطية سليمة لاستعادتها.'
      : loadError?.code === 'WRITE_FAILED'
        ? 'فشل الحفظ؛ تم إيقاف التعديلات. استرجع نسخة سليمة أو استورد نسخة احتياطية.'
        : loadError?.code === 'READ_FAILED'
          ? 'تعذّرت القراءة. ستُعاد محاولة التحقق قبل الاستعادة أو الاستيراد، ولن يُكتب فوق الملف غير المقروء.'
          : 'تعذّرت قراءة بيانات التطبيق. لم يتم تغيير الملف؛ افحص التخزين ثم أعد فتح التطبيق.';
    L.innerHTML='<div class="empty">'+message+'</div>';tick();setStorageControls();return;
  }
  if(!m.length){L.innerHTML='<div class="empty">لا توجد حركات في هذا الشهر.<br>اضغط «حضور» لتبدأ.</div>';tick();return;}
  const g={},order=[];
  m.forEach(x=>{
    const k=dateKeyOf(x);
    if(k){
      if(!g[k]){g[k]=[];order.push(k);}
      g[k].push(x);
    }
  });
  order.sort((a,b)=>{
    const ka=firstDateKeyOf(g[a]);
    const kb=firstDateKeyOf(g[b]);
    if(!ka&&!kb) return 0;
    if(!ka) return 1;
    if(!kb) return -1;
    return new Date(ka).getTime()-new Date(kb).getTime();
  });
  L.innerHTML=order.map(k=>{
    const a=g[k];
    const firstKey=firstDateKeyOf(a);
    return '<div class="day"><div class="dh"><span>'+(firstKey?new Date(firstKey+'T00:00:00').toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long'}):'—')+'</span><em>'+dur(dset[k])+'</em></div>'+a.map(x=>'<div class="se"><span class="t"><u>'+(x.i?tm(x.i):'—')+'</u> — '+(x.o?tm(x.o):'مستمر')+'</span><span class="d">'+dur(len(x))+'</span><button class="del" data-id="'+x.id+'" aria-label="حذف">✕</button></div>').join('')+'</div>';
  }).join('');
  L.querySelectorAll('.del').forEach(b=>b.onclick=async()=>{const id=+b.dataset.id;if(await commitData(S.filter(x=>x.id!==id)))toast('تم حذف الحركة');});
  tick();
}
function tick(){
  const d=new Date();$('clock').textContent=d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('date').textContent=d.toLocaleDateString('ar-EG',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(!dataReady){$('state').className='state off';$('state').textContent='تعذّر تحميل بيانات الحضور';return;}
  const s=open_(); $('state').className='state'+(s?'':' off'); $('state').innerHTML=s?'<b>الحضور مسجل — العمل مستمر</b>':'الحالة: <b>غير مسجل حضور</b>';
}

(async()=>{
  try {
    const loaded = await readData();
    // V2: ترحيل السجلات القديمة — أضف recordType='auto' للسجلات التي لا تحتوي عليه.
    S = loaded.data.map(s => ({ ...s, recordType: s.recordType || 'auto' }));
    persistedData = cloneData(S);
    dataReady = true;
    loadError = null;
    primaryNeedsRecovery = false;
    primaryMustBeMissing = loaded.status === 'missing';
    corruptOriginalRaw = null;
    let last = null;
    try { last = localStorage.getItem(LAST_EXPORT_KEY); } catch { /* Export metadata is optional. */ }
    if (last && isNative && last.startsWith(`${EXPORT_DIR}/`)) { lastExportPath = last; $('share').disabled = false; }
    setStorageControls();
    render();
    await makeDailyBackup();
    await autoSync();
  } catch (error) {
    loadError = error;
    primaryNeedsRecovery = true;
    corruptOriginalRaw = error?.code === 'CORRUPT_DATA' ? error.raw ?? null : null;
    dataReady = false;
    S = [];
    persistedData = [];
    $('storageStatus').textContent = error?.message || 'تعذّرت قراءة بيانات الحضور؛ لم يتم تعديل الملف.';
    setStorageControls();
    render();
    // fallback: جرّب سحب البيانات من السحابة إذا كان المحلي تالفًا أو مفقودًا
    try {
      const cloud = await syncFromCloud();
      if (cloud.ok && cloud.sessions && cloud.sessions.length > 0) {
        S = cloud.sessions;
        persistedData = cloneData(cloud.sessions);
        dataReady = true;
        loadError = null;
        $('storageStatus').textContent = `تم استعادة ${cloud.sessions.length} سجل من السحابة.`;
        render();
      }
    } catch { /* Supabase غير مضبوط أو غير متاح؛ يبقى الوضع كما هو. */ }
  }
  setInterval(tick,1000);
})();
