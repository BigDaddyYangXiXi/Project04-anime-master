// Exact signed, absent-provider probe through the real WeChat SDK; no business writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { envelope } = require('../cloudfunctions/order-api/slot-relay');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const root = path.resolve(__dirname, '..');
const pending = path.join(root, '.artifacts/company-slot-sdk-pending.json');
async function run() {
  const connection = await Connection.create('ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const timeout = setTimeout(() => { connection.dispose(); process.exitCode = 1; }, 25000);
  try {
    let job;
    if (fs.existsSync(pending)) job = JSON.parse(fs.readFileSync(pending));
    else {
      const appId = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId);
      if (appId !== 'wxc94e1c1b38944511') throw Error('APP_ID_MISMATCH');
      const provider = crypto.randomBytes(16).toString('hex');
      const raw = execFileSync(process.execPath, [path.join(root, 'scripts/cloudbase-company-cli.js'), 'db', 'execute', '--read-only', '--sql',
        `SELECT DATABASE() AS db, (SELECT COUNT(*) FROM accounts WHERE id='${provider}') AS matches`, '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
      const checked = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).data?.items?.[0];
      if (checked?.db !== 'cloudbase-d2g65rqbvee0bd978' || Number(checked.matches) !== 0) throw Error('ABSENT_PROVIDER_NOT_CONFIRMED');
      const secret = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-order-split-secret.json'))).key;
      job = { key: `__slotSdkAudit_${Date.now()}` };
      fs.writeFileSync(pending, JSON.stringify(job), { flag: 'wx' });
      const event = envelope({ provider_id: provider }, {}, secret);
      // Only a short-lived signature leaves this process, never the signing key.
      await mini.evaluate((key, signed) => {
        const state = { done: false }; getApp()[key] = state;
        (async () => {
          try {
            wx.cloud.init({ env: 'cloudbase-d2g65rqbvee0bd978', traceUser: true });
            const valid = (await wx.cloud.callFunction({ name: 'order-slot-confirm', data: signed })).result;
            const invalid = (await wx.cloud.callFunction({ name: 'order-slot-confirm', data: { ...signed, body: signed.body + ' ' } })).result;
            state.result = { signedRequestReachedDatabase: valid?.ok === false && valid.code === 'PROVIDER_NOT_AVAILABLE',
              tamperedRequestRejected: invalid?.ok === false && invalid.code === 'SLOT_STORE_NOT_CONFIGURED',
              responseCode: valid?.code || null, rejectionStage: valid?.stage || null };
            state.result.ok = state.result.signedRequestReachedDatabase && state.result.tamperedRequestRejected;
          } catch { state.result = { ok: false, code: 'SDK_CALL_FAILED' }; }
          state.done = true;
        })();
      }, job.key, event);
    }
    for (let i = 0; i < 32; i++) {
      const state = await mini.evaluate(key => getApp()[key] || null, job.key);
      if (!state) throw Error('PENDING_JOB_MISSING');
      if (state.done) {
        const result = { checkedAt: new Date().toISOString(), ...state.result, writesPerformed: false,
          scope: 'Real WeChat SDK to private slot service; absent-provider empty read, not a two-party order confirmation.' };
        fs.writeFileSync(path.join(root, '.artifacts/company-slot-sdk-runtime.json'), JSON.stringify(result, null, 2));
        fs.unlinkSync(pending); console.log(JSON.stringify(result));
        if (!result.ok) process.exitCode = 1;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('PENDING_JOB_STILL_RUNNING');
  } finally { clearTimeout(timeout); mini.disconnect(); }
}
run().catch(error => { console.error(['APP_ID_MISMATCH', 'ABSENT_PROVIDER_NOT_CONFIRMED', 'PENDING_JOB_MISSING', 'PENDING_JOB_STILL_RUNNING'].includes(error.message) ? error.message : 'SLOT_SDK_AUDIT_FAILED'); process.exitCode = 1; });
