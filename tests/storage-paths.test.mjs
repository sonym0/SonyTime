import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoragePaths } from '../src/storage-paths.mjs';

test('production storage paths preserve the existing SonyTime namespace', () => {
  assert.deepEqual(createStoragePaths(false), {
    root: 'SonyTime',
    dataPath: 'SonyTime/data.json',
    backupDir: 'SonyTime/backup',
    recoveryDir: 'SonyTime/recovery',
    exportDir: 'SonyTime/exports',
    shareCacheDir: 'SonyTime/exports',
    backupDatePath: 'SonyTime/.last_backup_date.txt',
    localDataKey: 'sonytime.v1.1',
    backupMetaKey: 'sonytime.lastBackupDate',
    lastExportKey: 'sonytime.lastExportPath',
    backupPrefix: 'sonytime.backup.',
    safetyPrefix: 'sonytime.safety.',
    corruptPrefix: 'sonytime.corrupt.',
  });
});

test('test build storage is isolated from production files and localStorage keys', () => {
  const production = createStoragePaths(false);
  const testBuild = createStoragePaths(true);
  for (const key of ['dataPath', 'backupDir', 'recoveryDir', 'exportDir', 'shareCacheDir', 'backupDatePath']) {
    assert.notEqual(testBuild[key], production[key]);
    assert.ok(testBuild[key].startsWith('SonyTimeTest/'));
  }
  for (const key of ['localDataKey', 'backupMetaKey', 'lastExportKey', 'backupPrefix', 'safetyPrefix', 'corruptPrefix']) {
    assert.notEqual(testBuild[key], production[key]);
    assert.ok(testBuild[key].startsWith('sonytime.test.'));
  }
});
