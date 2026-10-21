const assert = require("node:assert/strict");

const uploads = [];
const calls = [];
const assets = new Map();
// Isolated in-process fixture; never enable cloud access in the project config.
const configPath = require.resolve("../miniprogram/config/cloudbase");
require(configPath);
require.cache[configPath].exports = { enabled: true, env: "test-environment" };
let assetSequence = 0;
global.wx = {
  cloud: {
    async callFunction({ name, data }) {
      calls.push({ name, data });
      if (name !== "media-upload") return { result: { ok: true, data: {} } };
      if (data.action === "prepareUpload") {
        assetSequence += 1;
        const assetId = `asset_${String(assetSequence).padStart(32, "0")}`;
        assets.set(assetId, "PENDING");
        return { result: { ok: true, data: { assetId, cloudPath: `user-uploads/acct_provider/order_delivery/${data.scopeId}/${assetId}.${data.mimeType === "application/pdf" ? "pdf" : "jpg"}` } } };
      }
      if (data.action === "commitUpload") {
        assets.set(data.assetId, "READY");
        return { result: { ok: true, data: { assetId: data.assetId, fileId: data.fileId, status: "READY" } } };
      }
      if (data.action === "cancelUpload") {
        if (assets.get(data.assetId) === "READY") return { result: { ok: false, error: { code: "MEDIA_STATE_INVALID" } } };
        assets.set(data.assetId, "DELETED");
        return { result: { ok: true, data: { assetId: data.assetId, status: "DELETED" } } };
      }
      throw new Error("unexpected media action");
    },
    async uploadFile({ cloudPath, filePath }) {
      uploads.push({ cloudPath, filePath });
      if (filePath === "fail.pdf") throw new Error("upload failed");
      return { fileID: `cloud://test-environment.bucket/${cloudPath}` };
    },
    async deleteFile() { throw new Error("direct delete must not be used"); }
  }
};

const cloudOrders = require("../miniprogram/services/cloud-orders");

(async () => {
  const existingAsset = "asset_99999999999999999999999999999999";
  const existing = `cloud://test-environment.bucket/user-uploads/acct_provider/order_delivery/ord_1/${existingAsset}.pdf`;
  const result = await cloudOrders.uploadDeliveryFiles("ord_1", [
    { name: "现有文件.pdf", assetId: existingAsset, fileId: existing },
    { name: "新交付图.JPG", path: "new.jpg", size: 1024 }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].fileId, existing);
  assert.match(result[1].fileId, /order_delivery\/ord_1\/asset_.+\.jpg$/);
  assert.match(result[1].assetId, /^asset_[0-9]{32}$/);
  assert.equal(uploads.length, 1);

  for (const invalid of [
    { name: "脚本.exe", path: "bad.exe", size: 100 },
    { name: "大文件.zip", path: "large.zip", size: 21 * 1024 * 1024 },
    { name: "空文件.txt", path: "empty.txt", size: 0 },
    { name: "缺少资产.pdf", fileId: existing },
    null
  ]) {
    const callsBefore = calls.length;
    const uploadsBefore = uploads.length;
    await assert.rejects(() => cloudOrders.uploadDeliveryFiles("ord_1", [
      { name: "可用.pdf", path: "valid.pdf", size: 100 }, invalid
    ]), (error) => /^DELIVERY_FILE_/.test(error.code));
    assert.equal(calls.length, callsBefore, "整批预检失败不得创建云资产或发起清理");
    assert.equal(uploads.length, uploadsBefore, "后续文件无效时也不得先上传前面的文件");
  }

  await assert.rejects(
    () => cloudOrders.uploadDeliveryFiles("ord_1", [{ name: "脚本.exe", path: "bad.exe", size: 100 }]),
    (error) => error.code === "DELIVERY_FILE_TYPE_UNSUPPORTED"
  );
  await assert.rejects(
    () => cloudOrders.uploadDeliveryFiles("ord_1", [{ name: "大文件.zip", path: "large.zip", size: 21 * 1024 * 1024 }]),
    (error) => error.code === "DELIVERY_FILE_SIZE_INVALID"
  );
  await assert.rejects(
    () => cloudOrders.uploadDeliveryFiles("ord_1", [
      { name: "成功.pdf", path: "ok.pdf", size: 100 },
      { name: "失败.pdf", path: "fail.pdf", size: 100 }
    ]),
    /upload failed/
  );
  assert.equal(calls.filter((item) => item.name === "media-upload" && item.data.action === "cancelUpload").length, 2);
  assert.deepEqual([...assets.values()], ["READY", "READY", "DELETED"]);
  console.log("Cloud delivery client audit passed: pending failures are cancelled, READY assets are retained and the original upload error is preserved");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
