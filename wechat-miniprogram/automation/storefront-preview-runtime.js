const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
let stage = 'connect';
async function run() {
  const connection = await Connection.create('ws://127.0.0.1:9423');
  const mini = new MiniProgram(connection);
  const out = path.resolve(__dirname, '../.artifacts/storefront-preview-boundary');
  fs.mkdirSync(out, { recursive: true });
  const checks = [];
  try {
    assert.equal(await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), 'wxc94e1c1b38944511');
    if (process.argv.includes('--draft')) {
      stage = 'load-editor';
      let editor = await mini.reLaunch('/pages/provider-profile/index');
      let data;
      for (let i = 0; i < 45; i++) {
        data = await editor.data();
        if (data.cloudError || (data.remoteEnabled === true && data.cloudLoading === false)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(data.remoteEnabled, true);
      assert.equal(data.cloudLoading, false);
      assert.equal(data.cloudError, '');
      stage = 'open-draft';
      const expected = await mini.evaluate(() => {
        const page = getCurrentPages().slice(-1)[0];
        const draft = page.buildDraftValue();
        const result = { id: page.serverProviderId, nickname: draft.profile.nickname, works: draft.works.length };
        page.openDraftPreview(draft, page.data.remoteDraftVersion, true);
        return result;
      });
      stage = 'draft-identity';
      assert.match(expected.id, /^acct_[a-f0-9]{32}$/);
      let preview;
      for (let i = 0; i < 30; i++) {
        preview = await mini.currentPage();
        if (preview.path === 'pages/provider-detail/index' && await preview.data('provider.id') === expected.id) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      stage = 'preview-route';
      assert.equal(preview.path, 'pages/provider-detail/index');
      stage = 'preview-author';
      assert.equal(await preview.data('provider.id'), expected.id);
      assert.equal(await preview.data('provider.name'), expected.nickname);
      assert.equal(await preview.data('visitorDraftPreview'), true);
      stage = 'preview-screenshot';
      await mini.screenshot({ path: path.join(out, 'valid-draft-provider.png') });
      stage = 'preview-schedule';
      await (await preview.$('[data-tab="schedule"]')).tap();
      for (let i = 0; i < 20 && await preview.data('profileTab') !== 'schedule'; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(await preview.data('profileTab'), 'schedule');
      const days = await preview.data('availabilityDays');
      const today = await mini.evaluate(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      });
      assert.equal(days[0].date, today);
      assert.equal(days.length, 8);
      await mini.screenshot({ path: path.join(out, 'valid-draft-schedule.png') });
      await mini.pageScrollTo(100000);
      await new Promise(resolve => setTimeout(resolve, 400));
      await mini.screenshot({ path: path.join(out, 'valid-draft-schedule-bottom.png') });
      stage = 'return-editor';
      await mini.navigateBack();
      editor = await mini.currentPage();
      assert.equal(editor.path, 'pages/provider-profile/index');
      assert.equal(await editor.data('remoteEnabled'), true);
      await mini.screenshot({ path: path.join(out, 'draft-editor-return.png') });
      const report = { checkedAt: new Date().toISOString(), ok: true, authorMatchesServerDraft: true,
        returnedToEditor: true, scheduleUsesCurrentDate: true, workCount: expected.works, writesPerformed: false,
        scope: 'Existing cloud draft via direct openDraftPreview method; no save/publish click or work creation, no physical-device acceptance.' };
      fs.writeFileSync(path.join(out, 'valid-draft-runtime.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      return;
    }
    for (const [route, id, entity] of [['provider-detail', '1', 'provider'], ['work-detail', 'w-mu-1', 'work']]) {
      const page = await mini.reLaunch(`/pages/${route}/index?id=${id}&workspace=provider&preview=storefront`);
      let data;
      for (let i = 0; i < 30; i++) {
        data = await page.data();
        if (data.loadError || data[entity] || (entity === 'provider' && data.storefrontDraftPreview === false)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(data[entity], null, `${route}: fixture appeared`);
      if (entity === 'provider') {
        assert.equal(await (await page.$('.empty-page-title')).text(), '没有找到服务者');
        assert.equal(data.storefrontDraftPreview, false);
      } else assert.ok(data.loadError, `${route}: missing unavailable state`);
      await mini.screenshot({ path: path.join(out, `${route}.png`) });
      checks.push({ route, fixtureHidden: true, unavailableShown: true });
    }
    const report = { checkedAt: new Date().toISOString(), ok: true, checks, writesPerformed: false,
      scope: 'Cloud-connected DevTools expired preview routes; valid editor drafts and physical devices require separate acceptance.' };
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { mini.disconnect(); }
}
run().catch(() => { console.error(`STOREFRONT_PREVIEW_RUNTIME_FAILED:${stage}`); process.exitCode = 1; });
