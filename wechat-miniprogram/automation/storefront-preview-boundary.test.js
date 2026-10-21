const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(route, draft, local = false, owner = 'real_provider') {
  let result, fixtureReads = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${route}/index.js`), 'utf8'), {
    Page: value => { result = value; },
    require(name) {
      if (name.endsWith('local-preview')) return { isAudit: () => local };
      if (name.endsWith('storefront-preview-draft')) return { get: () => draft };
      if (name.endsWith('/catalog')) return { findProvider: () => { fixtureReads++; return { id: 'demo', name: 'Demo' }; }, allWorks: () => { fixtureReads++; return []; } };
      if (name.endsWith('v063-store')) return { CURRENT_PROVIDER_ID: 'demo', migrateLegacyMedia() { fixtureReads++; return null; } };
      return {};
    }, wx: { showToast() {} }, getApp:()=>({globalData:{account:{id:owner}}})
  });
  result.setData = value => Object.assign(result.data, value);
  result.fixtureReads = () => fixtureReads;
  return result;
}
const draft = { providerId: 'real_provider', profile: { nickname: '真实作者', city: '上海', uid: 'AM_REAL' },
  works: [{ id: 'real_work', title: '草稿作品' }], services: [] };

test('切号后不能打开上一账号的橱窗或案例草稿快照',()=>{
 for(const route of ['provider-detail','work-detail']){
  const p=page(route,draft,false,'other_owner');let read=false;
  p.loadCloudProvider=()=>{read=true;};p.loadCloudWork=()=>{read=true;};
  p.loadProvider=()=>assert.fail('旧账号草稿不可见');p.loadWork=()=>assert.fail('旧账号草稿不可见');
  p.onLoad({id:route==='provider-detail'?'real_provider':'real_work',workspace:'provider',preview:'storefront'});
  assert.equal(read,true);
 }
});

test('expired or mismatched connected provider preview uses public cloud data', () => {
  for (const staged of [null, { ...draft, providerId: 'other' }]) {
    const p = page('provider-detail', staged);
    let loaded;
    p.loadCloudProvider = (_, id) => { loaded = id; };
    p.loadProvider = () => assert.fail('Must not show a local fixture');
    p.onLoad({ id: 'real_provider', workspace: 'provider', preview: 'storefront', visitor: '1' });
    assert.equal(loaded, 'real_provider');
    assert.equal(p.data.storefrontDraftPreview, false);
    assert.equal(p.data.visitorDraftPreview, false);
    assert.equal(p.fixtureReads(), 0);
  }
});
test('matching connected provider draft remains a draft preview', () => {
  const p = page('provider-detail', draft);
  let loaded;
  p.loadCloudProvider = () => assert.fail('Must preserve a valid editor draft');
  p.loadProvider = (_, provider) => { loaded = provider; };
  p.onLoad({ id: 'real_provider', workspace: 'provider', preview: 'storefront' });
  assert.equal(loaded.id, draft.providerId);
  assert.equal(loaded.name, draft.profile.nickname);
  assert.equal(p.fixtureReads(), 0);
});
test('expired or missing-work connected preview cannot enter demo migration or catalogue', () => {
  for (const staged of [null, { ...draft, works: [] }]) {
    const p = page('work-detail', staged);
    let loaded;
    p.loadCloudWork = options => { loaded = options.id; };
    p.onLoad({ id: 'real_work', workspace: 'provider', preview: 'storefront' });
    assert.equal(loaded, 'real_work');
    assert.equal(p.storefrontDraftPreview, false);
    assert.equal(p.fixtureReads(), 0);
  }
});
test('connected draft work uses its real author and never migrates local fixtures', () => {
  const p = page('work-detail', draft);
  let rendered;
  p.renderWork = work => { rendered = work; };
  p.onLoad({ id: 'real_work', workspace: 'provider', preview: 'storefront' });
  assert.equal(rendered.provider.id, 'real_provider');
  assert.equal(rendered.provider.name, '真实作者');
  assert.equal(rendered.provider.uid, 'AM_REAL');
  assert.equal(p.fixtureReads(), 0);
});
