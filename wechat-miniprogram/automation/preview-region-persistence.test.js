const test = require('node:test');
const assert = require('node:assert/strict');
const storage = new Map([['animeMasterLocalPreview', true]]);
global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), getDeviceInfo: () => ({ platform: 'devtools' }) };
let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/discover/index');
function open(options = {}) {
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), discovery: JSON.parse(JSON.stringify(definition.discovery)) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.onLoad(options);
  return page;
}
test('本地选择完整地区后，页面重建恢复地区与可见结果', async () => {
  const page = open();
  await page.applyDiscoveryRegion({ provinceName: '浙江省', cityName: '杭州市', districtName: '余杭区', cityCode: '330100' }, false);
  const reopened = open();
  assert.equal(reopened.data.locationLabel, '杭州·余杭区');
  assert.deepEqual(reopened.data.regionValue, ['浙江省', '杭州市', '余杭区']);
  assert.ok(reopened.data.visibleWorks.length);
  await reopened.applyDiscoveryRegion({ provinceName: '浙江省', cityName: '杭州市', districtName: '西湖区', cityCode: '330100' }, false);
  assert.equal(open().data.locationLabel, '杭州·西湖区');
});
test('正式版本不读取本地审查地区，开发预览不由旧存储开关退出', () => {
  storage.set('animeMasterLocalPreview', false);
  assert.equal(open().data.locationLabel, '杭州·西湖区');
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } });
  assert.equal(open().data.locationLabel, '');
  delete wx.getAccountInfoSync;
  storage.set('animeMasterLocalPreview', true);
});
