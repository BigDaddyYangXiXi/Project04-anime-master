// Read existing backup metadata only. Never create, restore, delete or download a backup.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
try {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'db', 'backup', 'list', '--limit', '20', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const response = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1));
  if (run.status !== 0 || response.error || !Array.isArray(response.data)) throw Error('BACKUP_LIST_FAILED');
  const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
  const backups = response.data.map(item => ({
    id: scalar(item.BackupId), status: scalar(item.BackupStatus), usable: scalar(item.IsUsable),
    method: scalar(item.BackupMethod), type: scalar(item.BackupType),
    startedAt: scalar(item.StartTime), finishedAt: scalar(item.FinishTime),
    snapshotAt: scalar(item.SnapshotTime), sizeBytes: scalar(item.FileSize)
  }));
  const report = { checkedAt: new Date().toISOString(), environment: 'cloudbase-d2g65rqbvee0bd978',
    returned: backups.length, total: scalar(response.meta?.total), backups, writesPerformed: false,
    scope: 'Existing backup metadata, up to 20 entries. API usability is not a verified restore. No retention policy, media backup or independent restore has been verified.' };
  fs.writeFileSync(path.join(root, '.artifacts/company-database-backups.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch { console.error('COMPANY_DATABASE_BACKUP_AUDIT_FAILED'); process.exitCode = 1; }
