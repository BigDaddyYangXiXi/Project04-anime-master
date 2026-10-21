const test = require('node:test'), assert = require('node:assert/strict');
const { rdbExactCount } = require('./rdb-exact-count');
function sdk(results) {
  let index = 0;
  return { init: () => ({ rdb: () => ({ from(table) {
    assert.equal(table, 'account_saved_items');
    return { select(column, options) {
      assert.equal(column, 'target_id'); assert.equal(options.count, 'exact');
      assert.equal(options.head, index % 2 === 0);
      return { eq(key, value) { assert.ok(['target_type', 'saved'].includes(key)); return this; },
        async limit(n) { assert.equal(n, 1); return results[index++]; } };
    } };
  } }) }) };
}
test('bounded HEAD/GET count comparison never returns row data', async () => {
  const result = await rdbExactCount(sdk([237,237,0,0].map(count => ({ count, data: [{target_id:'private'}] }))));
  assert.equal(result.ok, true); assert.equal(result.samples.length, 4);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
test('missing, mismatched and errored counts do not pass', async () => {
  for (const results of [[{}, {}, {}, {}], [1,2,0,0].map(count=>({count})), Array(4).fill({count:0,error:'secret'})]) {
    const result = await rdbExactCount(sdk(results)); assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});
