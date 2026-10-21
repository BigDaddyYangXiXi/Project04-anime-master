const fs = require('node:fs');
const path = require('node:path');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const pendingFile = path.resolve(__dirname, '../.artifacts/company-payment-audit-pending.json');
const outputFile = path.resolve(__dirname, '../.artifacts/company-payment-closed-runtime.json');
const env = 'cloudbase-d2g65rqbvee0bd978', appid = 'wxc94e1c1b38944511';
async function run() {
  const connection = await Connection.create('ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const limit = setTimeout(() => { console.error('AUDIT_OBSERVATION_TIMEOUT; pending job retained'); connection.dispose(); process.exit(1); }, 25000);
  try {
    let job;
    if (fs.existsSync(pendingFile)) job = JSON.parse(fs.readFileSync(pendingFile));
    else {
      const clientAppId = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId);
      if (clientAppId && clientAppId !== appid) throw Error('APP_ID_MISMATCH');
      job = { key: `__companyPaymentClosed_${Date.now()}`, env, appid };
      fs.writeFileSync(pendingFile, JSON.stringify(job), { flag: 'wx' });
      await mini.evaluate(function start(target) {
        const localId = wx.getAccountInfoSync().miniProgram.appId;
        if (localId && localId !== target.appid) throw Error('APP_ID_MISMATCH');
        const state = { done: false, stage: 'identity' }; getApp()[target.key] = state;
        (async () => {
          try {
            wx.cloud.init({ env: target.env, traceUser: true });
            const identity = (await wx.cloud.callFunction({ name: 'auth-probe', data: {} })).result;
            if (identity?.ok !== true || identity?.data?.authenticated !== true || identity?.data?.appId !== target.appid) {
              state.result = { ok: false, code: 'SERVER_IDENTITY_NOT_VERIFIED' }; state.done = true; return;
            }
            state.stage = 'payment-closed';
            const create = { action: 'createPayment', orderId: 'audit_closed_service', requestKey: 'audit_closed_service_request', expectedVersion: 1 };
            const cases = [
              { name: 'prepayClosed', data: create, expected: 'PAYMENT_PREPAY_NOT_ENABLED' },
              { name: 'rejectClientAmount', data: { ...create, amountFen: 1 }, expected: 'PAYMENT_INPUT_INVALID' },
              { name: 'privateDatabaseMissingOrder', data: { action: 'refreshPayment', orderId: 'audit_closed_service' }, expected: 'ORDER_NOT_FOUND' }
            ];
            const checks = [];
            for (const item of cases) {
              state.stage = item.name;
              const result = (await wx.cloud.callFunction({ name: 'payment-api', data: item.data })).result;
              checks.push({ name: item.name, ok: result?.ok === false && result?.error?.code === item.expected,
                code: result?.error?.code || 'UNEXPECTED_PAYMENT_RESPONSE' });
            }
            state.result = { ok: checks.every(item => item.ok), serverIdentityVerified: true, checks,
              code: checks[0].code };
          } catch (error) {
            const message = String(error?.errMsg || error?.message || '');
            state.result = { ok: false, code: 'CLOUD_CALL_FAILED', stage: state.stage,
              errorCode: typeof error?.errCode === 'number' ? error.errCode : null,
              reason: /appid missing/i.test(message) ? 'APPID_MISSING'
                : message.includes('wx.cloud.init') ? 'CLOUD_INIT'
                : /not a function/.test(message) ? 'API_UNAVAILABLE'
                : /permission|权限/i.test(message) ? 'PERMISSION'
                : /timeout|超时/i.test(message) ? 'TIMEOUT'
                : /env|环境/i.test(message) ? 'ENVIRONMENT' : 'UNKNOWN' };
          }
          state.done = true;
        })();
        return true;
      }, job);
    }
    for (let i = 0; i < 35; i++) {
      const state = await mini.evaluate(key => getApp()[key] || null, job.key);
      if (!state) throw Error('PENDING_JOB_MISSING; inspect before restarting');
      if (state.done) {
        const result = { checkedAt: new Date().toISOString(), ...state.result, writesPerformed: false };
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        fs.unlinkSync(pendingFile);
        console.log(JSON.stringify(result));
        if (!result.ok) process.exitCode = 1;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('PENDING_JOB_STILL_RUNNING');
  } finally { clearTimeout(limit); mini.disconnect(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
