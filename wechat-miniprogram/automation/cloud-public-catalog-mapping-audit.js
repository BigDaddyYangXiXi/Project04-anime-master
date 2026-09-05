const assert = require("node:assert/strict");
const { mapCloudCatalog } = require("../miniprogram/data/cloud-public-catalog");

const result = mapCloudCatalog([{
  id: "acct_1", uid: "AM_1", nickname: "云用户", avatarUrl: "https://avatar", career: "摄影", city: "上海", bio: "简介", notice: "须知", tags: ["棚拍"],
  services: [{ id: "service_1", name: "正片", priceFen: 68000, unit: "套", description: "说明" }],
  works: [{ id: "work_1", serviceId: "service_1", code: "AM-1", title: "作品", subtitle: "副标题", priceFen: 68000, description: "描述", tags: ["棚拍"], imageUrls: ["https://image"] }]
}]);
assert.equal(result.providers[0].name, "云用户");
assert.equal(result.providers[0].avatar, "https://avatar");
assert.equal(result.providers[0].services[0].price, 680);
assert.deepEqual(result.providers[0].services[0].workIds, ["work_1"]);
assert.equal(result.works[0].provider.id, "acct_1");
assert.deepEqual(result.works[0].imagePreviews, ["https://image"]);
assert.equal(result.providers[0].orders, 0);
assert.equal(result.providers[0].rating, null);
process.stdout.write("Cloud public catalog mapping audit passed\n");
