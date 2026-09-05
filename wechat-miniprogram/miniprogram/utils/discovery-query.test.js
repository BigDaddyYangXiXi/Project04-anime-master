const test = require("node:test");
const assert = require("node:assert/strict");
const { serverFilters } = require("./discovery-query");

test("maps UI selections to grouped server filters", () => {
  assert.deepEqual(serverFilters("310000", "摄影", "2026-09-20", "夜景", ["棚拍", "夜景", "电影光", "￥1000–2000"]), {
    cityCode: "310000",
    career: "摄影",
    date: "2026-09-20",
    query: "夜景",
    tagGroups: [["棚拍", "夜景"], ["电影光"]],
    priceMinFen: 100000,
    priceMaxFen: 200000,
    limit: 50
  });
});
