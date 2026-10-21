const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalCityCode, locationPreference, pickerRegion, regionLabel } = require("./discovery-region");

test("地区展示保留已选区，不伪造缺失地区", () => {
  assert.equal(regionLabel({ cityName: "杭州市", districtName: "余杭区" }), "杭州·余杭区");
  assert.equal(regionLabel({ cityName: "杭州市", districtName: "" }), "杭州");
  assert.equal(regionLabel({ cityName: "北京市", districtName: "市辖区" }), "北京");
});

test("reads city and code from the native region picker", () => {
  assert.deepEqual(pickerRegion({ value: ["上海市", "上海市", "徐汇区"], code: ["310000", "310000", "310104"] }), {
    provinceName: "上海市", cityName: "上海市", districtName: "徐汇区", cityCode: "310000"
  });
  assert.equal(pickerRegion({ value: ["上海市"], code: [] }), null);
  assert.equal(canonicalCityCode("310101"), "310000");
  assert.equal(canonicalCityCode("330106"), "330100");
  assert.equal(canonicalCityCode("invalid"), "");
});

test("manual and project choices persist while stale located choices are refreshed", () => {
  const now = 10_000;
  assert.equal(locationPreference({ cityCode: "310000", cityName: "上海市", source: "MANUAL" }, 100, now).cityCode, "310000");
  assert.equal(locationPreference({ cityCode: "310000", cityName: "上海市", source: "LOCATED", locatedAt: 9_950 }, 100, now).cityCode, "310000");
  assert.equal(locationPreference({ cityCode: "310000", cityName: "上海市", source: "LOCATED", locatedAt: 9_000 }, 100, now), null);
});
