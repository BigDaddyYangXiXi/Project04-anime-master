const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const concurrent = process.argv.includes('--concurrent');
const prefix = concurrent ? 'company-project-concurrent' : 'company-project-write';
const pending = path.resolve(__dirname, `../.artifacts/${prefix}-pending.json`);
const output = path.resolve(__dirname, `../.artifacts/${prefix}-runtime.json`);
async function run() {
  const connection = await Connection.create('ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const limit = setTimeout(() => { connection.dispose(); console.error('OBSERVATION_TIMEOUT; resume same job'); process.exit(1); }, 25000);
  try {
    let job;
    if (fs.existsSync(pending)) job = JSON.parse(fs.readFileSync(pending));
    else {
      if (fs.existsSync(output)) throw Error('AUDIT_ALREADY_EXECUTED; inspect existing project');
      job = { key: `__projectWriteAudit_${Date.now()}`, requestKey: `launch-project-audit-${crypto.randomUUID()}`, concurrent };
      fs.writeFileSync(pending, JSON.stringify(job), { flag: 'wx' });
      await mini.evaluate(function start(target) {
        const state = { done: false, stage: 'identity' }; getApp()[target.key] = state;
        (async () => {
          const call = async (name, data) => (await wx.cloud.callFunction({ name, data })).result;
          const project = async data => {
            const result = await call('project-api', data);
            if (result?.ok !== true) throw { auditCode: result?.error?.code || 'PROJECT_CALL_FAILED' };
            return result.data;
          };
          try {
            wx.cloud.init({ env: 'cloudbase-d2g65rqbvee0bd978' });
            const identity = await call('auth-probe', {});
            if (identity?.data?.authenticated !== true || identity.data.appId !== 'wxc94e1c1b38944511') throw { auditCode: 'IDENTITY_NOT_VERIFIED' };
            state.stage = 'create';
            if (target.concurrent) {
              const pair = await Promise.all([0, 1].map(() => call('project-api', { action: 'createProject', idempotencyKey: target.requestKey })));
              state.concurrentResults = pair.map(result => ({ ok: result?.ok === true, id: result?.data?.id, code: result?.error?.code }));
              state.concurrentMatched = pair.every(result => result?.ok === true) && pair[0].data.id === pair[1].data.id;
            }
            const created = await project({ action: 'createProject', idempotencyKey: target.requestKey });
            state.projectId = created.id;
            if (target.concurrent) state.concurrentMatched = state.concurrentMatched && state.concurrentResults.every(item => item.id === created.id);
            state.stage = 'repeatCreate';
            const repeated = await project({ action: 'createProject', idempotencyKey: target.requestKey });
            state.idempotent = repeated.id === created.id && repeated.version === created.version;
            if (!state.idempotent) throw { auditCode: 'CREATE_NOT_IDEMPOTENT' };
            state.stage = 'save';
            const fields = { title: '上线验收测试项目（自动清理）', date: '2026-09-25', city: '上海', cityCode: '310000',
              location: '仅用于接口验收，无实际活动', description: '独立测试记录，无订单和附件', targetAssetIds: [] };
            const saved = await project({ action: 'saveProject', projectId: created.id, expectedVersion: created.version, project: fields });
            state.stage = 'staleSave';
            const stale = await call('project-api', { action: 'saveProject', projectId: created.id, expectedVersion: created.version,
              project: { ...fields, title: '不应写入的过期修改' } });
            state.staleRejected = stale?.ok === false && stale?.error?.code === 'VERSION_CONFLICT';
            state.stage = 'readBack';
            const read = await project({ action: 'getProject', projectId: created.id });
            state.persisted = read.title === fields.title && read.version === saved.version && saved.version === created.version + 1;
            state.version = read.version;
            state.ok = state.idempotent && state.staleRejected && state.persisted && (!target.concurrent || state.concurrentMatched);
          } catch (error) { state.ok = false; state.code = error?.auditCode || 'SDK_CALL_FAILED'; }
          state.done = true;
        })();
      }, job);
    }
    for (let i = 0; i < 35; i++) {
      const state = await mini.evaluate(key => getApp()[key] || null, job.key);
      if (!state) throw Error('PENDING_JOB_MISSING; inspect before restarting');
      fs.writeFileSync(pending, JSON.stringify({ ...job, observed: state }));
      if (state.done) {
        fs.writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), requestKey: job.requestKey, ...state }, null, 2));
        fs.unlinkSync(pending);
        console.log(JSON.stringify({ ok: state.ok, stage: state.stage, idempotent: state.idempotent, concurrentMatched: state.concurrentMatched,
          concurrentCodes: state.concurrentResults?.map(item => item.code || null), staleRejected: state.staleRejected, persisted: state.persisted, code: state.code }));
        if (!state.ok) process.exitCode = 1;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('PENDING_JOB_STILL_RUNNING');
  } finally { clearTimeout(limit); mini.disconnect(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
