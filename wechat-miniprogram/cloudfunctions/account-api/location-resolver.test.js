const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalCityCode, resolvedRegion } = require("./location-resolver");

test('reverse geocoder signs sorted raw parameters and encodes only the final URL', () => {
  const url = new URL(require('./location-resolver').geocoderUrl(31.2, 121.5, 'test-key', 'test-secret'));
  assert.equal(url.searchParams.get('sig'), 'c054bb3a70a6811bb0348a5023d91ae2');
  assert.equal(url.searchParams.get('location'), '31.2,121.5');
  assert.equal(url.href.includes('test-secret'), false);
});

test("normalizes municipality and ordinary city codes", () => {
  assert.equal(canonicalCityCode("310101"), "310000");
  assert.equal(canonicalCityCode("110105"), "110000");
  assert.equal(canonicalCityCode("330106"), "330100");
  assert.equal(canonicalCityCode(""), "");
});

test("maps reverse-geocoder result to one canonical region", () => {
  assert.deepEqual(resolvedRegion({ status: 0, result: { address_component: { province: "上海市", city: "上海市", district: "徐汇区" }, ad_info: { adcode: "310104" } } }), {
    provinceName: "上海市", cityName: "上海市", districtName: "徐汇区", cityCode: "310000"
  });
  assert.equal(resolvedRegion({ status: 1 }), null);
});
