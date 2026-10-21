const test = require('node:test');
const assert = require('node:assert/strict');
const cloudOrders = require('../miniprogram/services/cloud-orders');
const definitions = {};
for (const route of ['orders', 'provider-orders']) {
  global.Page = definition => { definitions[route] = definition; };
  require(`../miniprogram/pages/${route}/index`);
}
delete global.Page;
function create(route) {
  global.getApp = () => ({ globalData: { account: { id: 'account-a' } } });
  const definition = definitions[route];
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return page;
}
function pending() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('订单根页切供需身份先清除旧角色列表', async t => {
  const page = create('orders');
  t.mock.method(cloudOrders, 'listOrders', async () => [{ id: 'buyer-order', stage: 'REQUESTED', viewerRole: 'BUYER' }]);
  await page.refresh();
  const response = pending();
  t.mock.method(cloudOrders, 'listOrders', () => response.promise);
  page.data.role = 'provider';
  const read = page.refresh();
  assert.equal(page.data.ready, false);
  assert.deepEqual(page.data.orders, []);
  assert.deepEqual(page.allOrders, []);
  response.resolve([{ id: 'provider-order', stage: 'REQUESTED', viewerRole: 'PROVIDER' }]);
  await read;
  assert.equal(page.data.orders[0].id, 'provider-order');
});
for (const route of Object.keys(definitions)) {
  test(`${route}: 传输失败保留已读列表，明确服务错误清除数据，重试恢复`, async t => {
    const page = create(route);
    const rows = [{ id: 'existing', stage: 'REQUESTED', viewerRole: route === 'orders' ? 'BUYER' : 'PROVIDER' }];
    t.mock.method(cloudOrders, 'listOrders', async () => rows);
    await page.refresh();
    t.mock.method(cloudOrders, 'listOrders', async () => { throw { errMsg: 'cloud.callFunction:fail network', errCode: -1 }; });
    await page.refresh();
    assert.equal(page.data.orders[0].id, 'existing');
    assert.equal(page.data.ready, true);
    assert.equal(page.allOrders, rows);
    assert.ok(page.data.loadError);
    for (const code of ['AUTH_CONTEXT_MISSING', 'ACCOUNT_NOT_FOUND', 'ORDER_ROLE_FORBIDDEN', 'CLOUD_REQUEST_FAILED', 'ORDER_API_FAILED']) {
      t.mock.method(cloudOrders, 'listOrders', async () => rows);
      await page.refresh();
      t.mock.method(cloudOrders, 'listOrders', async () => { throw Object.assign(Error(code), { code }); });
      await page.refresh();
      assert.equal(page.data.ready, false);
      assert.deepEqual(page.data.orders, []);
      assert.deepEqual(page.allOrders, []);
    }
    t.mock.method(cloudOrders, 'listOrders', async () => rows);
    await page.refresh();
    assert.equal(page.data.ready, true);
    assert.equal(page.data.loadError, '');
  });
  test(`${route}: 同范围刷新保留已读状态，切分类先清除旧列表`, async t => {
    const page = create(route);
    t.mock.method(cloudOrders, 'listOrders', async () => [{ id: 'booking', stage: 'REQUESTED', viewerRole: route === 'orders' ? 'BUYER' : 'PROVIDER' }]);
    await page.refresh();
    const response = pending();
    t.mock.method(cloudOrders, 'listOrders', () => response.promise);
    const refresh = page.refresh();
    assert.equal(page.data.ready, true);
    assert.equal(page.data.orders[0].id, 'booking');
    response.resolve([]);
    await refresh;
    assert.equal(page.data.ready, true);
    const changed = pending();
    t.mock.method(cloudOrders, 'listOrders', () => changed.promise);
    page.data.group = 'execution';
    const read = page.refresh();
    assert.equal(page.data.ready, false);
    assert.deepEqual(page.data.orders, []);
    assert.deepEqual(page.allOrders, []);
    changed.resolve([]);
    await read;
    assert.equal(page.data.ready, true);
  });
  test(`${route}: 账号变化丢弃旧读取并禁止旧列表跳转`, async t => {
    const page = create(route), response = pending();
    let account = 'account-a';
    global.getApp = () => ({ globalData: { account: { id: account } } });
    global.wx = { navigateTo: () => assert.fail('不能打开旧账号订单') };
    t.mock.method(cloudOrders, 'listOrders', () => response.promise);
    const read = page.refresh();
    account = 'account-b';
    response.resolve([{ id: 'private', stage: 'REQUESTED', viewerRole: route === 'orders' ? 'BUYER' : 'PROVIDER' }]);
    await read;
    assert.equal(page.data.orders.length, 0);
    page.allOrders = [{ id: 'private', stage: 'REQUESTED' }];
    page.open({ currentTarget: { dataset: { id: 'private' } } });
    assert.deepEqual(page.allOrders, []);
    t.mock.method(cloudOrders, 'listOrders', async () => [{ id: 'new', stage: 'REQUESTED', viewerRole: route === 'orders' ? 'BUYER' : 'PROVIDER' }]);
    await page.refresh();
    assert.equal(page.data.orders[0].id, 'new');
    account = null;
    t.mock.method(cloudOrders, 'listOrders', () => assert.fail('未登录不得请求订单'));
    await page.refresh();
    assert.deepEqual(page.data.orders, []);
    assert.deepEqual(page.allOrders, []);
  });
  test(`${route}: 快速切换分类，旧请求成功或失败不覆盖最新分类`, async t => {
    for (const failed of [false, true]) {
      const page = create(route), first = pending(), second = pending();
      let calls = 0;
      t.mock.method(cloudOrders, 'listOrders', () => ++calls === 1 ? first.promise : second.promise);
      const oldRead = page.refresh();
      page.data.group = 'execution';
      const newRead = page.refresh();
      const current = [{ id: 'current', stage: 'IN_PRODUCTION', viewerRole: route === 'orders' ? 'BUYER' : 'PROVIDER' }];
      second.resolve(current);
      await newRead;
      assert.equal(page.data.orders[0].id, 'current');
      if (failed) first.reject(Error('old network error')); else first.resolve([]);
      await oldRead;
      assert.equal(page.data.orders[0].id, 'current');
      assert.equal(page.allOrders, current);
      assert.equal(page.data.loadError, '');
    }
  });
  test(`${route}: 卸载后不更新旧页面`, async t => {
    for (const failed of [false, true]) {
      const page = create(route), response = pending();
      t.mock.method(cloudOrders, 'listOrders', () => response.promise);
      const read = page.refresh();
      page.onUnload();
      page.setData = () => assert.fail('卸载后不能写页面');
      if (failed) response.reject(Error('late error')); else response.resolve([]);
      await read;
      t.mock.method(cloudOrders, 'listOrders', () => assert.fail('卸载后不得重新读取'));
      await page.refresh();
    }
  });
}
