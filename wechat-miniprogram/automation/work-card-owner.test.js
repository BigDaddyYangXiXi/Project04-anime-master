const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let definition;
global.Component = value => { definition = value; };
require('../miniprogram/components/work-card/index');
delete global.Component;

test('shared work cards retain author identity and encode route parameters', () => {
  for (const work of [
    { id: 'same_work', providerId: 'author_one' },
    { id: 'same_work', provider: { id: 'author_two' } },
    { id: 'work & one', providerId: 'author/one' }
  ]) {
    const component = { data: {}, setData(value) { Object.assign(this.data, value); } };
    definition.properties.work.observer.call(component, work);
    assert.equal(component.data.workIdParam, encodeURIComponent(work.id));
    assert.equal(component.data.workOwnerQuery, '&providerId=' + encodeURIComponent(work.providerId || work.provider.id));
  }
  const template = fs.readFileSync(require.resolve('../miniprogram/components/work-card/index.wxml'), 'utf8');
  assert.match(template, /id=\{\{workIdParam\}\}\{\{workOwnerQuery\}\}/);
});

test('clearing a recycled work card clears its prior route identity', () => {
  const component = { data: {}, setData(value) { Object.assign(this.data, value); } };
  const update = work => definition.properties.work.observer.call(component, work);
  update({ id: 'work', providerId: 'author' });
  update(null);
  assert.equal(component.data.workIdParam, '');
  assert.equal(component.data.workOwnerQuery, '');
});
