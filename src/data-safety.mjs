const MAX_JSON_TEXT_LENGTH = 10 * 1024 * 1024;

export class DataSafetyError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DataSafetyError';
    this.code = code;
  }
}

export function classifyWriteReadback(observed, attemptedData, previousData) {
  if (observed?.status === 'missing') return 'missing';
  if (observed?.status !== 'ok' || !Array.isArray(observed.data)) return 'unknown';
  const serialized = JSON.stringify(observed.data);
  if (serialized === JSON.stringify(attemptedData)) return 'attempted';
  if (serialized === JSON.stringify(previousData)) return 'previous';
  return 'unexpected';
}

export function shouldTreatMissingAsFirstRun({ primaryNeedsRecovery = false, previousErrorCode = null, knownRecords = 0 } = {}) {
  return !primaryNeedsRecovery && knownRecords === 0 && !['WRITE_FAILED', 'CORRUPT_DATA'].includes(previousErrorCode);
}

export function shouldWriteToMissingPrimary(primaryMustBeMissing, currentExists) {
  return !primaryMustBeMissing || !currentExists;
}

export async function chooseUnusedName(makeCandidate, exists, maxAttempts = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = makeCandidate();
    if (typeof candidate !== 'string' || !candidate) throw new DataSafetyError('INVALID_PATH', 'تعذّر إنشاء اسم صالح للنسخة الاحتياطية.');
    if (!await exists(candidate)) return candidate;
  }
  throw new DataSafetyError('NO_UNIQUE_PATH', 'تعذّر إيجاد اسم جديد للنسخة الاحتياطية؛ لم يتم استبدال نسخة موجودة.');
}

export function backupTimestamp(name, exportedAt = null) {
  const filename = String(name ?? '');
  const nativeStamp = filename.match(/(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (nativeStamp) {
    const parsed = Date.parse(`${nativeStamp[1]}:${nativeStamp[2]}:${nativeStamp[3]}.${nativeStamp[4]}Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const epoch = filename.match(/(\d{13})(?:[.]|-|$)/);
  if (epoch) return Number(epoch[1]);
  const day = filename.match(/(?:data-|sonytime\.backup\.)(\d{4}-\d{2}-\d{2})(?:T|[.]|$)/);
  if (day) {
    const filenameDate = day[1];
    if (typeof exportedAt === 'string') {
      const exportedTime = Date.parse(exportedAt);
      if (Number.isFinite(exportedTime) && new Date(exportedTime).toISOString().slice(0, 10) === filenameDate) return exportedTime;
    }
    const parsed = Date.parse(`${filenameDate}T00:00:00.000Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function validateSessions(value) {
  if (!Array.isArray(value)) return { valid: false, reason: 'expected_array' };
  if (value.length > 100000) return { valid: false, reason: 'too_many_records' };
  const identifiers = new Set();
  let openAutoSessions = 0;
  const manualAllowedKeys = new Set(['id', 'i', 'o', 'recordType', 'manualDurationOnly', 'durationMinutes', 'dateKey', 'note']);
  const autoAllowedKeys = new Set(['id', 'i', 'o']);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || Object.getPrototypeOf(item) !== Object.prototype ||
        !Number.isSafeInteger(item.id) || item.id < 0) {
      return { valid: false, reason: 'invalid_record', index };
    }
    const itemKeys = new Set(Object.keys(item));
    const allowedKeys = item.recordType === 'manual' ? manualAllowedKeys : autoAllowedKeys;
    for (const key of itemKeys) {
      if (!allowedKeys.has(key)) {
        return { valid: false, reason: 'unexpected_property', index, property: key };
      }
    }
    if (identifiers.has(item.id)) return { valid: false, reason: 'duplicate_id', index };
    identifiers.add(item.id);
    const isManual = item.recordType === 'manual';
    if (!isManual) {
      if (!Number.isSafeInteger(item.i) || item.i < 0 || item.i > 8_640_000_000_000_000 ||
          !(item.o === null || (Number.isSafeInteger(item.o) && item.o >= item.i && item.o <= 8_640_000_000_000_000))) {
        return { valid: false, reason: 'invalid_record', index };
      }
      if (item.o === null && ++openAutoSessions > 1) return { valid: false, reason: 'multiple_open_sessions', index };
    } else {
      const hasTimes = Number.isSafeInteger(item.i) && Number.isSafeInteger(item.o);
      const hasDuration = item.manualDurationOnly && Number.isFinite(item.durationMinutes) && item.durationMinutes > 0;
      if (!hasTimes && !hasDuration) return { valid: false, reason: 'invalid_record', index };
      if (hasTimes && item.o <= item.i) return { valid: false, reason: 'invalid_record', index };
    }
  }
  return { valid: true, data: value };
}

function missingFile(error) {
  const code = String(error?.code ?? '');
  if (['FILE_NOT_FOUND', 'ENOENT', 'OS-PLUG-FILE-0008'].includes(code)) return true;
  return /(?:file|path).*(?:does not exist|not found)|no such file/i.test(String(error?.message ?? ''));
}

export async function readSessions(readFile) {
  let raw;
  try {
    raw = await readFile();
  } catch (error) {
    if (error instanceof DataSafetyError) throw error;
    if (missingFile(error)) return { status: 'missing', data: [] };
    throw new DataSafetyError('READ_FAILED', 'تعذّرت قراءة ملف الحضور؛ لم تُمسح البيانات ولم يُسمح بالحفظ.', error);
  }
  if (typeof raw !== 'string' || raw.length > MAX_JSON_TEXT_LENGTH) {
    throw new DataSafetyError('READ_FAILED', 'ملف الحضور أكبر من الحد الآمن للقراءة أو تعذّر تفسيره؛ لم يتم تغييره.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const corrupt = new DataSafetyError('CORRUPT_DATA', 'ملف الحضور تالف أو ليس JSON صالحًا. احتفظ بالملف الأصلي واستعد نسخة سليمة.', error);
    corrupt.raw = raw;
    throw corrupt;
  }
  const result = validateSessions(parsed);
  if (!result.valid) {
    const corrupt = new DataSafetyError('CORRUPT_DATA', 'بنية ملف الحضور غير صالحة. احتفظ بالملف الأصلي واستعد نسخة سليمة.');
    corrupt.raw = raw;
    throw corrupt;
  }
  return { status: 'ok', data: result.data };
}

export function createBackupEnvelope(data, exportedAt = new Date().toISOString()) {
  const result = validateSessions(data);
  if (!result.valid) throw new DataSafetyError('INVALID_DATA', 'لا يمكن تصدير بيانات حضور غير صالحة.');
  return JSON.stringify({ format: 'sonytime-backup', version: 1, exportedAt, data }, null, 2);
}

export function parseBackup(raw) {
  if (typeof raw !== 'string' || raw.length > 10 * 1024 * 1024) {
    throw new DataSafetyError('INVALID_BACKUP', 'ملف النسخة الاحتياطية أكبر من الحد المسموح أو تنسيقه غير صحيح.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DataSafetyError('INVALID_BACKUP', 'ملف النسخة الاحتياطية ليس JSON صالحًا.', error);
  }
  const isLegacyArray = Array.isArray(parsed);
  if (!isLegacyArray && (parsed?.format !== 'sonytime-backup' || parsed?.version !== 1 ||
      typeof parsed?.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt)))) {
    throw new DataSafetyError('INVALID_BACKUP', 'بيانات تعريف النسخة الاحتياطية غير صالحة.');
  }
  const records = isLegacyArray ? parsed : parsed.data;
  const result = validateSessions(records);
  if (!result.valid) throw new DataSafetyError('INVALID_BACKUP', 'النسخة الاحتياطية غير صالحة أو لا تطابق تنسيق Sony Time.');
  return { data: result.data, exportedAt: isLegacyArray ? null : parsed.exportedAt };
}

export function verifySnapshotReadback(expectedRaw, observedRaw) {
  const expected = parseBackup(expectedRaw);
  const observed = parseBackup(observedRaw);
  if (expectedRaw !== observedRaw || JSON.stringify(expected.data) !== JSON.stringify(observed.data)) {
    throw new DataSafetyError('SNAPSHOT_MISMATCH', 'تعذّر التحقق من تطابق نسخة الأمان؛ لم يتم استبدال البيانات الأساسية.');
  }
  return observed;
}

export async function persistSessions(nextData, previousData, { writeSafety, writeMain, readMain }) {
  if (!validateSessions(nextData).valid || !validateSessions(previousData).valid) {
    throw new DataSafetyError('INVALID_DATA', 'تم رفض الحفظ لأن بنية بيانات الحضور غير صالحة.');
  }
  const nextPayload = JSON.stringify(nextData, null, 2);
  const previousPayload = JSON.stringify(previousData, null, 2);
  try {
    if (previousData.length > 0) await writeSafety(previousPayload);
    await writeMain(nextPayload);
    const savedPayload = await readMain();
    const savedData = JSON.parse(savedPayload);
    if (!validateSessions(savedData).valid || JSON.stringify(savedData) !== JSON.stringify(nextData)) {
      throw new Error('Saved data did not match the validated payload');
    }
  } catch (error) {
    throw new DataSafetyError('WRITE_FAILED', 'تعذّر تأكيد حفظ بيانات الحضور؛ افحص التخزين قبل إعادة المحاولة.', error);
  }
  return nextData;
}
