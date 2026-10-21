const test = require('node:test');
const assert = require('node:assert/strict');
let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/provider-detail/index');
delete global.Page;
const staged = require('../miniprogram/data/storefront-preview-draft');
const catalog = require('../miniprogram/services/cloud-catalog');

function page(local = false) {
  const instance = { ...definition, auditMode: local, publicationDraft: staged.get(),
    data: { storefrontDraftPreview: true, publishing: false, previewPublished: false, provider: { id: 'provider-test' } },
    setData(value) { Object.assign(this.data, value); } };
  return instance;
}

test('publication return action waits for completion and ignores departed pages', () => {
  let backs = 0;
  global.wx = { navigateBack() { backs++; } };
  const p = page();
  p.data.publishing = true; p.continueEditing(); assert.equal(backs, 0);
  p.data.publishing = false; p.continueEditing(); assert.equal(backs, 1);
  p.data.previewPublished = true; p.continueEditing(); assert.equal(backs, 2);
  p.unloaded = true; p.continueEditing(); assert.equal(backs, 2);
});

test('connected preview without a valid server version cannot report publication success', t => {
  const notices = [];
  global.wx = { showToast(value) { notices.push(value.title); } };
  t.mock.method(catalog, 'publishDraft', () => assert.fail('Invalid version must not reach server'));
  for (const version of [undefined, null, '2', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    staged.stage({ providerId: 'provider-test', draftVersion: version });
    const p = page();
    p.confirmPublish();
    assert.equal(p.data.previewPublished, false, `version ${version}`);
    assert.equal(staged.isPublished(), false);
    assert.equal(p.data.publishing, false);
    assert.match(notices.at(-1), /重新保存/);
  }
  staged.clear();
});

test('connected publication waits for server success and blocks duplicate taps', async t => {
  global.wx = { showToast() {} };
  let resolve, calls = 0;
  t.mock.method(catalog, 'publishDraft', version => {
    assert.equal(version, 2); calls++;
    return new Promise(done => { resolve = done; });
  });
  staged.stage({ providerId: 'provider-test', draftVersion: 2 });
  const p = page();
  p.confirmPublish(); p.confirmPublish();
  assert.equal(calls, 1);
  assert.equal(p.data.previewPublished, false);
  assert.equal(staged.isPublished(), false);
  resolve({});
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.previewPublished, true);
  assert.equal(staged.isPublished(), true);
  staged.clear();
});

test('server rejection leaves the preview unpublished and permits retry', async t => {
  global.wx = { showToast() {} };
  t.mock.method(catalog, 'publishDraft', async () => { throw { code: 'VERSION_CONFLICT' }; });
  staged.stage({ providerId: 'provider-test', draftVersion: 2 });
  const p = page();
  p.confirmPublish();
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.previewPublished, false);
  assert.equal(staged.isPublished(), false);
  assert.equal(p.data.publishing, false);
  assert.match(p.data.publishError, /草稿已更新/);
  staged.clear();
});

test('an old backend onboarding rejection never creates another application or claims publication success', async t => {
  global.wx = { showToast() {}, showModal() { assert.fail('manual application must not be offered'); } };
  t.mock.method(catalog, 'publishDraft', async () => { throw { code: 'PROVIDER_NOT_QUALIFIED' }; });
  staged.stage({ providerId: 'provider-test', draftVersion: 2 });
  const p = page();
  p.confirmPublish();
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.previewPublished, false);
  assert.equal(staged.isPublished(), false);
  assert.equal(p.data.publishing, false);
  assert.match(p.data.publishError, /规则尚未同步/);
  staged.clear();
});

test('publication response after leaving cannot mark a newer preview published or show stale errors', async t => {
  const notices = [];
  global.wx = { showToast(value) { notices.push(value.title); } };
  for (const succeeds of [true, false]) {
    let resolve, reject;
    t.mock.method(catalog, 'publishDraft', () => new Promise((yes, no) => { resolve = yes; reject = no; }));
    staged.stage({ providerId: 'provider-test', draftVersion: 2 });
    const p = page();
    p.requestQualificationReview = () => assert.fail('Unloaded page must not open review');
    p.confirmPublish();
    p.onUnload();
    staged.stage({ providerId: 'provider-test', draftVersion: 3 });
    if (succeeds) resolve({}); else reject({ code: 'PROVIDER_NOT_QUALIFIED' });
    await new Promise(done => setImmediate(done));
    assert.equal(staged.isPublished(), false);
    assert.equal(p.data.previewPublished, false);
    assert.deepEqual(notices, []);
  }
  staged.clear();
});


test('old preview cannot publish a replacement draft even for the same provider', t => {
  const notices = []; global.wx = { showToast(value) { notices.push(value.title); } };
  let calls = 0; t.mock.method(catalog, 'publishDraft', async () => { calls++; });
  staged.stage({ providerId: 'provider-test', draftVersion: 2 }); const p = page();
  staged.stage({ providerId: 'provider-test', draftVersion: 3 }); p.confirmPublish();
  assert.equal(calls, 0); assert.equal(staged.isPublished(), false); assert.match(notices[0], /重新保存|重新预览/); assert.equal(p.data.storefrontDraftPreview, true); assert.match(p.data.publishError, /重新保存|重新预览/); staged.clear();
});

test('publishing an older snapshot never marks a newly staged draft published', async t => {
  global.wx = { showToast() {} }; let resolve;
  t.mock.method(catalog, 'publishDraft', () => new Promise(done => { resolve = done; }));
  staged.stage({ providerId: 'provider-test', draftVersion: 2 }); const p = page(); p.confirmPublish();
  staged.stage({ providerId: 'provider-test', draftVersion: 3 }); resolve({}); await new Promise(done => setImmediate(done));
  assert.equal(staged.isPublished(), false); assert.equal(staged.get().draftVersion, 3); assert.equal(p.data.previewPublished, true); staged.clear();
});

test('acknowledged queued publication permits leaving but never claims public success before server applies', async t => {
  global.wx={showToast(){},setStorageSync(){}};
  global.getApp=()=>({globalData:{account:{id:'provider-test'}}});
  t.mock.method(catalog,'publishDraft',async()=>({queued:true,intentId:'intent'}));
  let status='PENDING';
  t.mock.method(catalog,'getPublishIntent',async()=>({status}));
  staged.stage({providerId:'provider-test',draftVersion:2});
  const p=page();p.intentAttempts=5;p.confirmPublish();
  await new Promise(done=>setImmediate(done));clearTimeout(p.intentTimer);
  assert.equal(p.data.publishQueued,true);assert.equal(p.data.publishing,false);assert.equal(p.data.previewPublished,false);assert.equal(staged.isPublished(),false);
  status='APPLIED';await p.refreshPublicationIntent();
  assert.equal(p.data.publishQueued,false);assert.equal(p.data.previewPublished,true);assert.equal(staged.isPublished(),true);
  staged.clear();
});
