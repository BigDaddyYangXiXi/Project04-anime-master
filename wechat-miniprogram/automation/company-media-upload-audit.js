// Creates one unattached test asset, uploads a fixed PNG, commits it, then cancels it.
// --review submits once and retains the asset for callback evidence; never publishes it.
const fs = require('node:fs');
const path = require('node:path');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const review = process.argv.includes('--review');
const empty = process.argv.includes('--cancel-empty');
const uncommitted = empty || process.argv.includes('--cancel-uncommitted');
if (review && uncommitted) throw Error('INCOMPATIBLE_AUDIT_MODES');
const prefix = review ? 'company-media-review' : empty ? 'company-media-empty-cancel' : uncommitted ? 'company-media-uncommitted-cancel' : 'company-media-upload';
const pending = path.resolve(__dirname, `../.artifacts/${prefix}-pending.json`);
const output = path.resolve(__dirname, `../.artifacts/${prefix}-runtime.json`);
async function run() {
  const connection = await Connection.create('ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const limit = setTimeout(() => { connection.dispose(); console.error('OBSERVATION_TIMEOUT; resume same job'); process.exit(1); }, 25000);
  try {
    let job;
    if (fs.existsSync(pending)) job = JSON.parse(fs.readFileSync(pending, 'utf8'));
    else {
      if (review && fs.existsSync(output)) throw Error('REVIEW_ALREADY_ATTEMPTED; inspect existing asset instead of resubmitting');
      job = { key: `__mediaUploadAudit_${Date.now()}`, env: 'cloudbase-d2g65rqbvee0bd978', appid: 'wxc94e1c1b38944511', review, uncommitted, empty };
      if (process.argv.includes('--retry-uncommitted-cancel')) {
        if (!uncommitted) throw Error('UNCOMMITTED_MODE_REQUIRED');
        const previous = JSON.parse(fs.readFileSync(output, 'utf8'));
        if (previous.committed !== false || !previous.cleanupFailure || previous.cleaned
          || !/^asset_[a-f0-9]{32}$/.test(previous.assetId) || (!previous.fileId && !(empty && previous.uploaded === false))) throw Error('NO_FAILED_CANCELLATION');
        job.retryAsset = previous.assetId; job.retryFile = previous.fileId;
        if (!fs.existsSync(output + '.initial.json')) fs.copyFileSync(output, output + '.initial.json');
      }
      fs.writeFileSync(pending, JSON.stringify(job), { flag: 'wx' });
      await mini.evaluate(function start(target) {
        const state = { done: false, stage: 'identity', assetId: null, fileId: null }; getApp()[target.key] = state;
        (async () => {
          let localPath;
          const call = async (name, data) => {
            const result = (await wx.cloud.callFunction({ name, data })).result;
            if (result?.ok !== true) throw { auditCode: result?.error?.code || 'FUNCTION_FAILED', auditReason: result?.error?.reason };
            return result.data;
          };
          try {
            if (wx.getAccountInfoSync().miniProgram.appId !== target.appid) throw { auditCode: 'APP_ID_MISMATCH' };
            wx.cloud.init({ env: target.env });
            const identity = await call('auth-probe', {});
            if (!identity.authenticated || identity.appId !== target.appid) throw { auditCode: 'IDENTITY_NOT_VERIFIED' };
            const session = await call('account-bootstrap', { action: 'getSession' });
            if (!session.registered) throw { auditCode: 'REGISTERED_TEST_ACCOUNT_REQUIRED' };
            if (target.retryAsset) {
              state.assetId = target.retryAsset; state.fileId = target.retryFile; state.committed = false; state.uploaded = !target.empty;
              return;
            }
            const bytes = wx.base64ToArrayBuffer('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=');
            localPath = `${wx.env.USER_DATA_PATH}/${target.key}.png`;
            wx.getFileSystemManager().writeFileSync(localPath, bytes);
            state.stage = 'prepare';
            const prepared = await call('media-upload', { action: 'prepareUpload', purpose: 'WORK_IMAGE', mimeType: 'image/png', sizeBytes: bytes.byteLength, originalFilename: 'launch-upload-audit.png' });
            state.assetId = prepared.assetId;
            state.uploaded = false; state.committed = false;
            if (target.empty) return;
            state.stage = 'upload';
            state.fileId = (await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: localPath })).fileID;
            state.uploaded = true;
            state.committed = false;
            if (!target.uncommitted) {
              state.stage = 'commit';
              const committed = await call('media-upload', { action: 'commitUpload', assetId: state.assetId, fileId: state.fileId });
              state.committed = committed.status === 'PENDING_SECURITY_REVIEW' && committed.sizeBytes === bytes.byteLength;
              if (!state.committed) throw { auditCode: 'COMMIT_RESULT_MISMATCH' };
            }
            if (target.review) {
              state.stage = 'reviewSubmit'; state.reviewAttempted = true;
              const submitted = await call('media-security-submit', { action: 'submitImage', assetId: state.assetId });
              state.reviewStatus = submitted.status;
              state.stage = 'reviewCallback';
              for (let i = 0; i < 12 && state.reviewStatus === 'PENDING_SECURITY_REVIEW'; i++) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const checked = await call('media-security-submit', { action: 'getImageStatus', assetId: state.assetId });
                state.reviewStatus = checked.status;
              }
            }
          } catch (error) {
            state.failure = error?.auditCode || 'SDK_CALL_FAILED'; state.failedStage = state.stage;
          } finally {
            if (state.assetId && !state.reviewAttempted) {
              state.stage = 'cancel';
              try {
                const cancelled = await call('media-upload', { action: 'cancelUpload', assetId: state.assetId, ...(!target.uncommitted && state.fileId ? { fileId: state.fileId } : {}) });
                state.cleaned = cancelled.status === 'DELETED';
              } catch (error) { state.cleanupFailure = error?.auditCode || 'CLEANUP_FAILED'; if (error?.auditReason) state.cleanupReason = error.auditReason; }
            }
            if (localPath) { try { wx.getFileSystemManager().unlinkSync(localPath); } catch (_) {} }
            state.ok = (target.empty ? Boolean(state.assetId) && state.uploaded === false : target.uncommitted ? Boolean(state.fileId) && state.committed === false : state.committed === true) && !state.failure &&
              (target.review ? state.reviewStatus === 'READY' : state.cleaned === true);
            state.done = true;
          }
        })();
      }, job);
    }
    for (let i = 0; i < 35; i++) {
      const state = await mini.evaluate(key => getApp()[key] || null, job.key);
      if (!state) throw Error('PENDING_JOB_MISSING; inspect before restarting');
      fs.writeFileSync(pending, JSON.stringify({ ...job, observed: state }));
      if (state.done) {
        const report = { checkedAt: new Date().toISOString(), ...state };
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        fs.unlinkSync(pending);
        console.log(JSON.stringify({ ok: state.ok, uploaded: state.uploaded, committed: state.committed, cleaned: state.cleaned, reviewAttempted: state.reviewAttempted,
          reviewStatus: state.reviewStatus, failure: state.failure, failedStage: state.failedStage, cleanupFailure: state.cleanupFailure }));
        if (!state.ok) process.exitCode = 1;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('PENDING_JOB_STILL_RUNNING');
  } finally { clearTimeout(limit); mini.disconnect(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
