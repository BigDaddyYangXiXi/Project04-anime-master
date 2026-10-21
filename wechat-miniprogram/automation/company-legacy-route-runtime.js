const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
let stage = 'connect';
async function run() {
  const mini = new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
  const unpublished = process.argv.includes('--expect-unpublished');
  const out = path.resolve(__dirname, unpublished ? '../.artifacts/company-legacy-routes-publication-copy' : '../.artifacts/company-legacy-routes');
  fs.mkdirSync(out, { recursive: true });
  const originalRole = await mini.evaluate(() => wx.getStorageSync('animeMasterRole'));
  const checks = [];
  try {
    assert.equal(await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), 'wxc94e1c1b38944511');
    for (const [entry, target, mode, loading, error] of [
      ['provider-home', 'discover', 'dashboardCloudMode', 'dashboardLoading', 'dashboardError'],
      ['provider-calendar', 'projects', 'cloudMode', 'calendarLoading', 'calendarError']
    ]) {
      for (const audit of [false, true]) {
        stage = `${entry}-${audit ? 'audit' : 'normal'}-navigate`;
        // The legacy page immediately redirects; wait for its destination, not the transient page.
        const navigation = await mini.evaluate(url => new Promise(resolve => {
          wx.reLaunch({ url, complete: result => resolve({ ok: result.errMsg === 'reLaunch:ok', message: result.errMsg }) });
        }), `/pages/${entry}/index${audit ? '?audit=1&changed=1' : ''}`);
        if (!navigation.ok) { console.error(JSON.stringify({ stage, navigation })); throw Error('NAVIGATION_FAILED'); }
        let state;
        for (let attempt = 0; attempt < 60; attempt++) {
          state = await mini.evaluate(fields => {
            const page = getCurrentPages().slice(-1)[0];
            return { route: page.route, role: page.data.role, cloud: page[fields.mode],
              loading: page.data[fields.loading], error: page.data[fields.error], visibility: page.data.providerVisibilityText };
          }, { mode, loading, error });
          if (state.route === `pages/${target}/index` && state.role === 'provider' && state.cloud === true && state.loading === false) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        stage = `${entry}-${audit ? 'audit' : 'normal'}-assert`;
        fs.writeFileSync(path.join(out, 'last-state.json'), JSON.stringify({ stage, ...state }, null, 2));
        assert.equal(state.route, `pages/${target}/index`);
        assert.equal(state.role, 'provider'); assert.equal(state.cloud, true);
        assert.equal(state.loading, false); assert.equal(state.error, '');
        if (unpublished && target === 'discover') assert.equal(state.visibility, '主页尚未公开');
        const name = `${entry}-${audit ? 'audit-parameter' : 'normal'}`;
        stage = name + '-screenshot';
        await mini.screenshot({ path: path.join(out, name + '.png') });
        checks.push({ entry, auditParameter: audit, destination: state.route, cloud: true, loaded: true });
      }
    }
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ok: true, checks,
      businessWritesRequested: false, scope: 'Connected validation build; local role changes restored. Not release-device or two-account acceptance.' }, null, 2));
    console.log(JSON.stringify({ ok: true, checks }));
  } finally {
    try {
      await mini.evaluate(role => role ? wx.setStorageSync('animeMasterRole', role) : wx.removeStorageSync('animeMasterRole'), originalRole);
      await mini.reLaunch('/pages/discover/index');
    } finally { mini.disconnect(); }
  }
}
run().catch(error => { console.error(JSON.stringify({ code: 'COMPANY_LEGACY_ROUTE_AUDIT_FAILED', stage,
  reason: error.code === 'ERR_ASSERTION' ? 'ASSERTION' : 'AUTOMATION' })); process.exitCode = 1; });
