const fs = require('node:fs');
const path = require('node:path');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
// Default checks are read-only. Explicit recovery mode mutates only the isolated test asset.
const recoveryMode = process.argv.includes('--recover-test-media');
const pendingFile = path.resolve(__dirname, recoveryMode ? '../.artifacts/company-media-recovery-pending.json' : '../.artifacts/company-session-audit-pending.json');
const outputFile = path.resolve(__dirname, recoveryMode ? '../.artifacts/company-media-recovery-runtime.json' : '../.artifacts/company-session-readonly-runtime.json');
const env = 'cloudbase-d2g65rqbvee0bd978', appid = 'wxc94e1c1b38944511';
async function run() {
  const connection = await Connection.create(process.env.WECHAT_AUTO_WS || 'ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const limit = setTimeout(() => { console.error('AUDIT_OBSERVATION_TIMEOUT; pending job retained'); connection.dispose(); process.exit(1); }, 25000);
  try {
    let job;
    if (fs.existsSync(pendingFile)) job = JSON.parse(fs.readFileSync(pendingFile));
    else {
      const clientAppId = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId);
      if (clientAppId && clientAppId !== appid) throw Error('APP_ID_MISMATCH');
      job = { key: `__companySessionRead_${Date.now()}`, env, appid, catalog: process.argv.includes('--catalog'), media: process.argv.includes('--media') };
      job.business = process.argv.includes('--business');
      job.orders = process.argv.includes('--orders');
      if (recoveryMode) {
        const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.artifacts/company-media-recovery-fixture.json')));
        if (!/^asset_[a-f0-9]{32}$/.test(fixture.assetId)) throw Error('INVALID_RECOVERY_FIXTURE');
        job.recoveryAsset = fixture.assetId;
      }
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
            state.stage = 'session';
            const response = await wx.cloud.callFunction({ name: 'account-bootstrap', data: { action: 'getSession' } });
            const result = response.result;
            state.result = { ok: result?.ok === true && typeof result?.data?.registered === 'boolean',
              serverIdentityVerified: true, code: result?.error?.code || null, registered: result?.data?.registered };
            if (state.result.ok && state.result.registered) {
              state.stage = 'profile';
              const profile = (await wx.cloud.callFunction({ name: 'account-api', data: { action: 'getMine' } })).result;
              state.result.profileReadable = profile?.ok === true &&
                typeof profile?.data?.id === 'string' && profile.data.id === result.data.account?.id;
              state.result.ok = state.result.profileReadable;
              if (!state.result.ok) state.result.code = profile?.error?.code || 'PROFILE_IDENTITY_MISMATCH';
            }
            if (state.result.ok && target.catalog) {
              state.result.catalog = [];
              for (const action of ['listProviders', 'listDiscovery']) {
                state.stage = action;
                const data = action === 'listDiscovery' ? { action, cityCode: '310000' } : { action };
                const catalog = (await wx.cloud.callFunction({ name: 'catalog-read', data })).result;
                const ok = catalog?.ok === true && Array.isArray(catalog?.data?.providers);
                state.result.catalog.push({ action, ok, count: ok ? catalog.data.providers.length : null });
                if (!ok) { state.result.ok = false; state.result.code = catalog?.error?.code || 'CATALOG_RESULT_INVALID'; break; }
              }
            }
            if (state.result.ok && target.media) {
              state.stage = 'mediaStatus';
              const media = (await wx.cloud.callFunction({ name: 'media-security-submit',
                data: { action: 'getImageStatus', assetId: 'asset_00000000000000000000000000000000' } })).result;
              state.result.mediaMissingAssetRejected = media?.ok === false && media?.error?.code === 'MEDIA_NOT_FOUND';
              state.result.ok = state.result.mediaMissingAssetRejected;
              if (!state.result.ok) state.result.code = media?.error?.code || 'MEDIA_BOUNDARY_UNEXPECTED';
              if (state.result.ok) {
                state.stage = 'mediaOwnedRead';
                const owned = (await wx.cloud.callFunction({ name: 'media-upload',
                  data: { action: 'getOwnedMedia', assetIds: ['asset_00000000000000000000000000000000'] } })).result;
                state.result.mediaOwnedReadPassed = owned?.ok === true && Array.isArray(owned?.data?.assets)
                  && owned.data.assets.length === 0;
                state.result.ok = state.result.mediaOwnedReadPassed;
                if (!state.result.ok) state.result.code = owned?.error?.code || 'MEDIA_OWNED_READ_UNEXPECTED';
              }
            }
            if (state.result.ok && target.recoveryAsset) {
              state.stage = 'mediaRecovery';
              const recovered = (await wx.cloud.callFunction({ name: 'media-security-submit',
                data: { action: 'getImageStatus', assetId: target.recoveryAsset } })).result;
              state.result.mediaRecovered = recovered?.ok === true && recovered?.data?.status === 'READY';
              state.result.ok = state.result.mediaRecovered;
              if (!state.result.ok) state.result.code = recovered?.error?.code || 'MEDIA_RECOVERY_INCOMPLETE';
            }
            if (state.result.ok && target.orders) {
              state.stage = 'order-api:listOrders';
              const response = (await wx.cloud.callFunction({ name: 'order-api', data: { action: 'listOrders' } })).result;
              const orders = response?.data?.orders;
              const accountId = result.data.account?.id;
              state.result.ordersReadable = response?.ok === true && Array.isArray(orders)
                && orders.every(order => order.buyerId === accountId || order.providerId === accountId);
              state.result.orderCount = Array.isArray(orders) ? orders.length : null;
              state.result.ok = state.result.ordersReadable;
              if (!state.result.ok) state.result.code = response?.error?.code || 'ORDER_RESULT_INVALID';
            }
            if (state.result.ok && target.business) {
              state.result.business = [];
              for (const [name, action] of [['project-api', 'listProjects'], ['saved-items-api', 'listMine'],
                ['availability-api', 'getMine'], ['provider-catalog-draft', 'getDraft'], ['provider-catalog-draft', 'getQualification']]) {
                state.stage = `${name}:${action}`;
                const response = (await wx.cloud.callFunction({ name, data: { action } })).result;
                const data = response?.data;
                const valid = action === 'listProjects' ? Array.isArray(data?.projects)
                  : action === 'listMine' ? Array.isArray(data?.providerIds) && Array.isArray(data?.workIds)
                  : action === 'getMine' ? data?.providerId === result.data.account?.id && Array.isArray(data?.openDates)
                  : action === 'getDraft' ? data?.providerId === result.data.account?.id && typeof data?.draft === 'object'
                  : typeof data?.status === 'string';
                const ok = response?.ok === true && valid;
                state.result.business.push({ name, action, ok, code: response?.error?.code || null });
                if (!ok) { state.result.ok = false; state.result.code = response?.error?.code || 'BUSINESS_RESULT_INVALID'; break; }
              }
            }
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
        const result = { checkedAt: new Date().toISOString(), ...state.result, writesPerformed: Boolean(job.recoveryAsset) };
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
