// Actual Mini Program cloud calls with empty payloads. Does not navigate or write business data.
const fs = require('node:fs');
const path = require('node:path');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const jobKey = '__paymentRelayClosedRuntime_20260924';
const retryFailed = process.argv.includes('--retry-failed');
const output = path.resolve(__dirname, '../.artifacts/payment-relay-closed-runtime.json');
(async () => {
  const mini = new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
  try {
    // The live app object, rather than a file, decides whether a prior call is still pending.
    await mini.evaluate(({ key, retry }) => {
      if (wx.getAccountInfoSync().miniProgram.appId !== 'wxc94e1c1b38944511') throw Error('APP_ID_MISMATCH');
      const previous = getApp()[key];
      if (previous && (!previous.done || !retry || previous.checks.every(item => item.ok))) return;
      const job = { done: false, checks: previous ? previous.checks.filter(item => item.ok) : [], stage: 'starting' }; getApp()[key] = job;
      wx.cloud.init({ env: 'cloudbase-d2g65rqbvee0bd978', traceUser: true });
      (async () => {
        for (const name of ['payment-mutation-guard', 'payment-query-relay', 'payment-mutation-relay']) {
          if (job.checks.some(item => item.name === name && item.ok)) continue;
          job.stage = name;
          try {
            const reply = await wx.cloud.callFunction({ name, data: {} });
            const code = name === 'payment-mutation-guard' ? 'PAYMENT_MUTATION_GUARD_FAILED' : 'PAYMENT_RELAY_FAILED';
            job.checks.push({ name, ok: reply.result?.ok === false && reply.result?.code === code,
              code: reply.result?.code || 'UNEXPECTED_RESPONSE' });
          } catch (error) {
            const message = String(error?.errMsg || error?.message || '');
            job.checks.push({ name, ok: false, code: 'CLOUD_CALL_FAILED', errorCode: error?.errCode || null,
              detail: message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 800) });
          }
        }
        job.done = true;
      })();
    }, { key: jobKey, retry: retryFailed });
    for (let attempt = 0; attempt < 45; attempt++) {
      const job = await mini.evaluate(key => getApp()[key] || null, jobKey);
      if (!job) throw Error('LIVE_JOB_MISSING');
      if (job.done) {
        const report = { checkedAt: new Date().toISOString(), ok: job.checks.length === 3 && job.checks.every(item => item.ok),
          checks: job.checks, writesPerformed: false, scope: 'Real Mini Program empty calls to closed services only.' };
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
        if (!report.ok) process.exitCode = 1;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const pending = await mini.evaluate(key => getApp()[key] || null, jobKey);
    console.log(JSON.stringify({ pending: true, stage: pending?.stage, checks: pending?.checks }));
    throw Error('LIVE_JOB_PENDING; rerun observes the same app job');
  } finally { mini.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
