const assert = require("node:assert/strict");

global.wx = {};
const client = require("../miniprogram/services/cloud-catalog");

const server = client.toServerDraft({
  career: "摄影",
  profile: { city: "上海", bio: "简介", notice: "须知", tags: "棚拍，男角,棚拍" },
  services: [{ id: "service_1", name: "正片", price: 680.5, unit: "套", description: "说明", workIds: ["work_1"] }],
  works: [{ id: "work_1", title: "作品", subtitle: "副标题", price: 680.5, description: "描述", tone: "coral", tags: ["棚拍"], imageAssetIds: ["asset_1"] }],
  pinnedWorkIds: ["work_1"],
  noticeImageAssetId: "asset_notice"
});
assert.equal(server.services[0].priceFen, 68050);
assert.equal(server.works[0].priceFen, 68050);
assert.deepEqual(server.profile.tags, ["棚拍", "男角"]);
assert.equal(server.profile.noticeImageAssetId, "asset_notice");

const clientDraft = client.toClientDraft(server, { nickname: "云端昵称" }, [
  { assetId: "asset_1", fileId: "cloud://work", tempFileURL: "https://temp/work", status: "READY" },
  { assetId: "asset_notice", fileId: "cloud://notice", tempFileURL: "https://temp/notice", status: "READY" }
]);
assert.equal(clientDraft.profile.nickname, "云端昵称");
assert.equal(clientDraft.services[0].price, 680.5);
assert.deepEqual(clientDraft.works[0].imagePreviews, ["https://temp/work"]);
assert.deepEqual(clientDraft.works[0].mediaStatuses, ["READY"]);
assert.equal(clientDraft.noticeImage, "https://temp/notice");
assert.deepEqual(clientDraft.works[0].tags, ["棚拍"]);
assert.deepEqual(client.toServerDraft(clientDraft).profile.tags, ["棚拍", "男角"]);
assert.equal(client.isAvailable(), false);

global.wx.cloud = {
  async callFunction() {
    return { result: { ok: true, data: { provider: {
      id: "provider_1", avatarFileId: "cloud://avatar", noticeImageFileId: null,
      works: [], services: [], tags: []
    } } } };
  },
  async getTempFileURL() {
    return { fileList: [{ fileID: "cloud://avatar", tempFileURL: "https://temp/avatar", status: 0 }] };
  }
};

client.getProvider("provider_1").then(({ provider }) => {
  assert.equal(provider.avatarUrl, "https://temp/avatar");
  process.stdout.write("Cloud catalog client mapping audit passed\n");
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
