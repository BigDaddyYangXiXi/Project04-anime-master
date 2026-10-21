const test = require('node:test');
const assert = require('node:assert/strict');
const context = { WX_OPENID: 'trusted-user' };
const cases = [
  ['media-upload/media-core', 'handleMediaUpload', ['prepareUpload', 'commitUpload', 'cancelUpload', 'getOwnedMedia'], (f, db, e) => f(db, {}, e, context)],
  ['media-security-submit/media-security-core', 'handleMediaSecurity', ['submitImage', 'getImageStatus'], (f, db, e) => f(db, {}, {}, e, context)],
  ['saved-items-api/saved-items-core', 'handleSavedItems', ['listMine', 'setSaved']],
  ['availability-api/availability-core', 'handleAvailability', ['getMine', 'saveMine']],
  ['project-api/project-core', 'handleProject', ['listProjects', 'getProject', 'createProject', 'saveProject', 'linkOrder', 'unlinkOrder']],
  ['provider-catalog-draft/draft-core', 'handleProviderDraft', ['getDraft', 'saveDraft']],
  ['provider-catalog-draft/qualification-core', 'handleQualification', ['getQualification', 'submitQualification']],
  ['provider-catalog-draft/publication-core', 'handleProviderPublish', ['publishDraft']]
];
function database(status) {
  const reads = [];
  return { reads, from(table) {
    reads.push(table);
    assert.ok(['wechat_identities', 'accounts'].includes(table), 'must stop before business reads or writes');
    const filters = [];
    const query = { select() { return query; }, eq(k, v) { filters.push([k, v]); return query; }, then(resolve) {
      const source = table === 'wechat_identities' ? [{ open_id: 'trusted-user', account_id: 'account' }]
        : status ? [{ id: 'account', status }] : [];
      return Promise.resolve({ data: source.filter(row => filters.every(([k, v]) => row[k] === v)) }).then(resolve);
    } };
    return query;
  } };
}
for (const [module, name, actions, invoke = (f, db, e) => f(db, e, context)] of cases) {
  test(`${module}: suspended, closed and missing accounts cannot use private operations`, async () => {
    const handler = require(`../cloudfunctions/${module}`)[name];
    for (const status of ['SUSPENDED', 'CLOSED', null]) for (const action of actions) {
      const db = database(status);
      await assert.rejects(() => invoke(handler, db, { action, assetId: 'asset_11111111111111111111111111111111', saved: false, expectedVersion: 1,
        status: 'ACTIVE', accountId: 'forged-active-account' }), { code: 'ACCOUNT_NOT_FOUND' });
      assert.deepEqual(db.reads, ['wechat_identities', 'accounts']);
    }
  });
}
