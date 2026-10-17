export function createStoragePaths(testBuild = false) {
  const root = testBuild ? 'SonyTimeTest' : 'SonyTime';
  const keyRoot = testBuild ? 'sonytime.test.' : 'sonytime.';
  return {
    root,
    dataPath: `${root}/data.json`,
    backupDir: `${root}/backup`,
    recoveryDir: `${root}/recovery`,
    exportDir: `${root}/exports`,
    shareCacheDir: `${root}/exports`,
    backupDatePath: `${root}/.last_backup_date.txt`,
    localDataKey: `${keyRoot}v1.1`,
    backupMetaKey: `${keyRoot}lastBackupDate`,
    lastExportKey: `${keyRoot}lastExportPath`,
    backupPrefix: `${keyRoot}backup.`,
    safetyPrefix: `${keyRoot}safety.`,
    corruptPrefix: `${keyRoot}corrupt.`,
  };
}
