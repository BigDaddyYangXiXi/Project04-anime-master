const { test } = require('node:test');
const assert = require('node:assert/strict');
const { auditWorkOwnership } = require('../scripts/audit-work-ownership');
const publication = (provider, ids) => ({ provider_id: provider, payload: { profile: {}, services: [], works: ids.map(id => ({ id })) } });
const input = () => ({ complete: true, publications: [publication('one', ['work'])], works: [], savedItems: [] });
test('complete unique ownership is a limited preflight, never migration authorization', () => {
  const data = input(); data.savedItems.push({ target_type: 'WORK', target_id: 'work', saved: 1 });
  const result = auditWorkOwnership(data);
  assert.equal(result.ownershipPreflightPassed, true);
  assert.equal(result.migrationAuthorized, false);
  delete data.complete;
  assert.equal(auditWorkOwnership(data).ownershipPreflightPassed, false);
});
test('colliding snapshots and inactive saved rows require explicit migration resolution', () => {
  const data = input(); data.publications.push(publication('two', ['work']));
  data.savedItems.push({ target_type: 'WORK', target_id: 'work', saved: 0 });
  const result = auditWorkOwnership(data);
  assert.deepEqual(result.collisions, [{ workId: 'work', ownerCount: 2 }]);
  assert.equal(result.ambiguousSavedItems, 1);
  assert.equal(result.ownershipPreflightPassed, false);
  data.publications.reverse(); assert.deepEqual(auditWorkOwnership(data), result);
});
test('unpublished legacy ownership remains relevant and is superseded only by its own snapshot', () => {
  const data = input(); data.works.push({ id: 'work', provider_id: 'two', status: 'DRAFT' });
  assert.equal(auditWorkOwnership(data).collisions.length, 1);
  data.publications.push(publication('two', []));
  assert.equal(auditWorkOwnership(data).collisions.length, 0);
});
test('damaged snapshot does not revive legacy ownership or produce a successful audit', () => {
  const data = input(); data.publications[0].payload = '{';
  data.works.push({ id: 'work', provider_id: 'one' });
  data.savedItems.push({ target_type: 'WORK', target_id: 'work' });
  const result = auditWorkOwnership(data);
  assert.equal(result.invalidRows, 1); assert.equal(result.unresolvedSavedItems, 1);
  assert.equal(result.ownershipPreflightPassed, false);
});
test('duplicate work ids and duplicate provider snapshots fail audit', () => {
  const data = input(); data.publications.push(publication('one', ['work', 'work']));
  assert.equal(auditWorkOwnership(data).invalidRows, 2);
});
test('missing tables and malformed rows cannot masquerade as an empty valid export', () => {
  assert.throws(() => auditWorkOwnership({}), /EXPORT_TABLES_REQUIRED/);
  const data = input(); data.works.push(null); data.savedItems.push(null); data.publications.push(null);
  assert.equal(auditWorkOwnership(data).invalidRows, 3);
});
