const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { envelope } = require('../cloudfunctions/order-api/slot-relay');
const root = path.resolve(__dirname, '..');
function cli(args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  let value;
  try { value = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1)); } catch {}
  if (result.status !== 0 || !value?.data || value.error) throw Error('CLOUD_AUDIT_COMMAND_FAILED');
  return value.data;
}
function run() {
  const provider = crypto.randomBytes(16).toString('hex');
  const identity = cli(['db', 'execute', '--read-only', '--sql',
    `SELECT DATABASE() AS db, (SELECT COUNT(*) FROM accounts WHERE id='${provider}') AS matches`]).items?.[0];
  if (identity?.db !== 'cloudbase-d2g65rqbvee0bd978' || Number(identity.matches) !== 0) throw Error('ABSENT_PROVIDER_NOT_CONFIRMED');
  const key = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-order-split-secret.json'))).key;
  // A verified absent provider causes an empty locking read and rollback before any order lookup or write.
  const signed = envelope({ provider_id: provider }, {}, key);
  const eventFile = path.join(root, '.cloudbase-cli-config/company-slot-audit-event.json');
  fs.writeFileSync(eventFile, JSON.stringify(signed));
  const signedReply = cli(['fn', 'invoke', 'order-slot-confirm', '-d', `@${eventFile}`]);
  const accepted = JSON.parse(signedReply.RetMsg);
  if (accepted.ok !== false || accepted.code !== 'PROVIDER_NOT_AVAILABLE') {
    console.log(JSON.stringify({ requestId: signedReply.RequestId, rejectedAtConfigurationOrAuthentication:
      accepted.code === 'SLOT_STORE_NOT_CONFIGURED', functionError: Boolean(signedReply.ErrMsg) }));
    console.log(JSON.stringify({ stage: accepted.stage, cause: accepted.cause }));
    throw Error('SIGNED_DATABASE_CHECK_FAILED');
  }
  fs.writeFileSync(eventFile, JSON.stringify({ ...signed, body: signed.body + ' ' }));
  const tamperedReply = cli(['fn', 'invoke', 'order-slot-confirm', '-d', `@${eventFile}`]);
  const rejected = JSON.parse(tamperedReply.RetMsg);
  if (rejected.ok !== false || rejected.code !== 'SLOT_STORE_NOT_CONFIGURED') throw Error('TAMPER_REJECTION_FAILED');
  const result = { ok: true, checkedAt: new Date().toISOString(), signedRequestReachedDatabase: true,
    missingProviderRejected: true, tamperedRequestRejected: true, writesPerformed: false,
    requestIds: [signedReply.RequestId, tamperedReply.RequestId],
    scope: 'Direct cloud invocation, empty locking read and rollback; not public-to-private business confirmation acceptance.' };
  fs.writeFileSync(path.join(root, '.artifacts/company-slot-connection-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
try { run(); } catch (error) {
  console.error(['ABSENT_PROVIDER_NOT_CONFIRMED', 'SIGNED_DATABASE_CHECK_FAILED', 'TAMPER_REJECTION_FAILED'].includes(error.message)
    ? error.message : 'COMPANY_SLOT_AUDIT_FAILED');
  process.exitCode = 1;
}
