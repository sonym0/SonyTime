import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackupEnvelope,
  backupTimestamp,
  classifyWriteReadback,
  chooseUnusedName,
  shouldTreatMissingAsFirstRun,
  shouldWriteToMissingPrimary,
  parseBackup,
  persistSessions,
  readSessions,
  verifySnapshotReadback,
  validateSessions,
} from '../src/data-safety.mjs';

const validRecords = [
  { id: 100, i: 1000, o: 2000 },
  { id: 200, i: 3000, o: null },
];

const readError = (code, message = code) => Object.assign(new Error(message), { code });

test('a missing primary file is a first-run state, not a read failure', async () => {
  const result = await readSessions(async () => { throw readError('FILE_NOT_FOUND'); });
  assert.deepEqual(result, { status: 'missing', data: [] });
});

test('a missing Capacitor file error is treated as a first-run state', async () => {
  const result = await readSessions(async () => { throw readError('OS-PLUG-FILE-0008'); });
  assert.deepEqual(result, { status: 'missing', data: [] });
});

test('malformed JSON is reported as corrupt instead of becoming empty data, retaining the exact original bytes', async () => {
  await assert.rejects(readSessions(async () => '{broken'), error => error.code === 'CORRUPT_DATA' && error.raw === '{broken');
});

test('a valid session file is loaded after schema validation', async () => {
  const result = await readSessions(async () => JSON.stringify(validRecords));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, validRecords);
});

test('oversized primary JSON is rejected before parsing', async () => {
  const raw = '[]' + ' '.repeat(10 * 1024 * 1024 + 1);
  await assert.rejects(readSessions(async () => raw), error => error.code === 'READ_FAILED');
});

test('non-missing filesystem errors are surfaced and never treated as first run', async () => {
  await assert.rejects(readSessions(async () => { throw readError('PERMISSION_DENIED'); }), error => error.code === 'READ_FAILED');
});

test('invalid session records fail schema validation', () => {
  assert.equal(validateSessions([{ id: 'bad', i: 1000, o: null }]).valid, false);
});

test('session records with unexpected properties are rejected', () => {
  assert.equal(validateSessions([{ id: 100, i: 1000, o: null, note: '<img>' }]).valid, false);
});

test('backup timestamps order newer safety snapshots ahead of older daily copies', () => {
  assert.ok(backupTimestamp('safety-2026-10-17T10-30-50-234Z-0.json') > backupTimestamp('data-2026-10-16.json'));
  assert.ok(backupTimestamp('data-2026-10-17.json', '2026-10-17T10:00:00.000Z') > backupTimestamp('safety-2026-10-17T09-00-00-000Z-0.json'));
});

test('a missing read-back after a failed first-run write remains an unsafe state', () => {
  assert.equal(classifyWriteReadback({ status: 'missing', data: [] }, validRecords, []), 'missing');
});

test('duplicate session identifiers are rejected', () => {
  const duplicated = [validRecords[0], { ...validRecords[1], id: validRecords[0].id }];
  assert.equal(validateSessions(duplicated).valid, false);
});

test('more than one open session is rejected', () => {
  const openSessions = [
    { id: 300, i: 4000, o: null },
    { id: 400, i: 5000, o: null },
  ];
  assert.equal(validateSessions(openSessions).valid, false);
});

test('backup timestamps ignore a future exportedAt inconsistent with the stored filename date', () => {
  assert.ok(backupTimestamp('data-2026-10-17.json', '2099-01-01T00:00:00.000Z') < Date.parse('2026-10-18T00:00:00.000Z'));
});

test('timestamped alternate daily backup filenames retain their exact write time', () => {
  assert.equal(backupTimestamp('data-2026-10-17T2026-10-17T11-22-33-123Z-random.json'), Date.parse('2026-10-17T11:22:33.123Z'));
});

test('a valid but different safety snapshot readback is rejected', () => {
  const expected = JSON.stringify(validRecords, null, 2);
  const different = JSON.stringify([{ id: 900, i: 9000, o: 10000 }], null, 2);
  assert.throws(() => verifySnapshotReadback(expected, different), error => error.code === 'SNAPSHOT_MISMATCH');
});

test('backup naming skips existing targets instead of reusing them', async () => {
  const existing = new Set(['backup-1', 'backup-2']);
  const candidates = ['backup-1', 'backup-2', 'backup-3'];
  let index = 0;
  const chosen = await chooseUnusedName(() => candidates[index++], async name => existing.has(name));
  assert.equal(chosen, 'backup-3');
});

test('a mismatched valid safety snapshot blocks the primary write', async () => {
  const events = [];
  const nextRecords = [{ id: 300, i: 5000, o: 6000 }];
  await assert.rejects(persistSessions(nextRecords, validRecords, {
    writeSafety: async raw => {
      events.push('safety');
      verifySnapshotReadback(raw, JSON.stringify([{ id: 901, i: 9100, o: 9200 }], null, 2));
    },
    writeMain: async () => events.push('main'),
    readMain: async () => JSON.stringify(validRecords),
  }), error => error.code === 'WRITE_FAILED');
  assert.deepEqual(events, ['safety']);
});

test('a missing file after an unconfirmed write is not treated as first run', () => {
  assert.equal(shouldTreatMissingAsFirstRun({ primaryNeedsRecovery: true, previousErrorCode: 'READ_FAILED', knownRecords: 0 }), false);
});

test('a missing-primary recovery refuses to write if the file reappears', () => {
  assert.equal(shouldWriteToMissingPrimary(true, true), false);
  assert.equal(shouldWriteToMissingPrimary(true, false), true);
});

test('session collections over the supported bound are rejected', () => {
  const tooMany = Array.from({ length: 100001 }, (_, index) => ({ id: index, i: index, o: null }));
  assert.equal(validateSessions(tooMany).valid, false);
});

test('session timestamps outside the JavaScript date range are rejected', () => {
  assert.equal(validateSessions([{ id: 1, i: 8640000000000001, o: null }]).valid, false);
});

test('first-run writes do not create an empty restore snapshot', async () => {
  const events = [];
  let primary = '[]';
  await persistSessions(validRecords, [], {
    writeSafety: async () => events.push('safety'),
    writeMain: async raw => { events.push('main'); primary = raw; },
    readMain: async () => primary,
  });
  assert.deepEqual(events, ['main']);
});

test('a successful write snapshots prior records and verifies the new primary file', async () => {
  const events = [];
  let primary = JSON.stringify(validRecords);
  const nextRecords = [...validRecords, { id: 300, i: 5000, o: 6000 }];
  const saved = await persistSessions(nextRecords, validRecords, {
    writeSafety: async raw => events.push(['safety', JSON.parse(raw)]),
    writeMain: async raw => { events.push(['main']); primary = raw; },
    readMain: async () => primary,
  });
  assert.deepEqual(saved, nextRecords);
  assert.deepEqual(events, [['safety', validRecords], ['main']]);
});

test('a failed primary write leaves a validated previous snapshot first', async () => {
  const events = [];
  const nextRecords = [...validRecords, { id: 300, i: 5000, o: 6000 }];
  await assert.rejects(persistSessions(nextRecords, validRecords, {
    writeSafety: async raw => events.push(['safety', JSON.parse(raw)]),
    writeMain: async () => { events.push(['main']); throw new Error('disk full'); },
    readMain: async () => '[]',
  }), error => error.code === 'WRITE_FAILED');
  assert.equal(events[0][0], 'safety');
  assert.deepEqual(events[0][1], validRecords);
  assert.equal(events[1][0], 'main');
});

test('a failed safety snapshot prevents overwriting the primary data', async () => {
  const events = [];
  const nextRecords = [...validRecords, { id: 300, i: 5000, o: 6000 }];
  await assert.rejects(persistSessions(nextRecords, validRecords, {
    writeSafety: async () => { events.push('safety'); throw new Error('quota exceeded'); },
    writeMain: async () => events.push('main'),
    readMain: async () => JSON.stringify(validRecords),
  }), error => error.code === 'WRITE_FAILED');
  assert.deepEqual(events, ['safety']);
});

test('a read-back mismatch is rejected as an unverified write', async () => {
  const nextRecords = [...validRecords, { id: 300, i: 5000, o: 6000 }];
  await assert.rejects(persistSessions(nextRecords, validRecords, {
    writeSafety: async () => {},
    writeMain: async () => {},
    readMain: async () => JSON.stringify(validRecords),
  }), error => error.code === 'WRITE_FAILED');
});

test('valid current and legacy daily backups can be parsed', () => {
  const envelope = createBackupEnvelope(validRecords, '2026-10-17T00:00:00.000Z');
  assert.deepEqual(parseBackup(envelope).data, validRecords);
  assert.deepEqual(parseBackup(JSON.stringify(validRecords)).data, validRecords);
});

test('backup metadata must contain a valid export timestamp', () => {
  const invalid = JSON.stringify({ format: 'sonytime-backup', version: 1, exportedAt: 'not-a-date', data: validRecords });
  assert.throws(() => parseBackup(invalid), error => error.code === 'INVALID_BACKUP');
});

test('oversized backup payloads are rejected before parsing', () => {
  const oversized = '[]' + ' '.repeat(10 * 1024 * 1024 + 1);
  assert.throws(() => parseBackup(oversized), error => error.code === 'INVALID_BACKUP');
});

test('invalid backup JSON and invalid backup structure are rejected', () => {
  assert.throws(() => parseBackup('{broken'), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => parseBackup(JSON.stringify([{ id: 1, i: 'bad', o: null }])), error => error.code === 'INVALID_BACKUP');
});

test('invalid session data is rejected before any write or backup operation', async () => {
  const events = [];
  await assert.rejects(persistSessions([{ id: 1, i: 'bad', o: null }], [], {
    writeSafety: async () => events.push('safety'),
    writeMain: async () => events.push('main'),
    readMain: async () => '[]',
  }), error => error.code === 'INVALID_DATA');
  assert.deepEqual(events, []);
});
