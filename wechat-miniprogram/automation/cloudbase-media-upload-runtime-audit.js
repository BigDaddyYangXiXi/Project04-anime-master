const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  let assetId = "";
  let fileId = "";
  let localPath = "";
  try {
    localPath = await miniProgram.evaluate(function writeMediaAuditFile() {
      const fs = wx.getFileSystemManager();
      const path = `${wx.env.USER_DATA_PATH}/anime-master-media-qa.png`;
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      return new Promise((resolve, reject) => fs.writeFile({
        filePath: path,
        data: pngBase64,
        encoding: "base64",
        success: () => resolve(path),
        fail: reject
      }));
    });

    const prepared = await miniProgram.evaluate(function prepareMediaAudit(env) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: {
          action: "prepareUpload",
          purpose: "WORK_IMAGE",
          mimeType: "image/png",
          sizeBytes: 68,
          originalFilename: "anime-master-media-qa.png"
        }
      }).then((response) => response.result);
    }, envId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    assetId = prepared.data.assetId;

    const upload = await miniProgram.evaluate(function uploadMediaAudit(cloudPath, path) {
      return wx.cloud.uploadFile({ cloudPath, filePath: path });
    }, prepared.data.cloudPath, localPath);
    fileId = upload.fileID;

    const committed = await miniProgram.evaluate(function commitMediaAudit(env, id, cloudFileId) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: { action: "commitUpload", assetId: id, fileId: cloudFileId }
      }).then((response) => response.result);
    }, envId, assetId, fileId);
    assert.equal(committed.ok, true, JSON.stringify(committed.error));
    assert.equal(committed.data.status, "PENDING_SECURITY_REVIEW");

    const cancelled = await miniProgram.evaluate(function cancelMediaAudit(env, id) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: { action: "cancelUpload", assetId: id }
      }).then((response) => response.result);
    }, envId, assetId);
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled.error));
    assert.equal(cancelled.data.status, "DELETED");
    assert.equal(JSON.stringify({ prepared, committed, cancelled }).includes("open_id"), false);
    assert.equal(JSON.stringify({ prepared, committed, cancelled }).includes("union_id"), false);

    await miniProgram.evaluate(function removeMediaAuditFile(path) {
      return new Promise((resolve) => wx.getFileSystemManager().unlink({ filePath: path, success: resolve, fail: resolve }));
    }, localPath);
    console.log(`CloudBase media runtime audit passed and cleaned: ${assetId}`);
  } catch (error) {
    if (assetId) {
      await miniProgram.evaluate(function cleanupFailedMediaAudit(env, id, cloudFileId) {
        wx.cloud.init({ env, traceUser: true });
        return wx.cloud.callFunction({
          name: "media-upload",
          data: { action: "cancelUpload", assetId: id, fileId: cloudFileId || undefined }
        }).catch(() => null);
      }, envId, assetId, fileId).catch(() => null);
    }
    if (localPath) {
      await miniProgram.evaluate(function removeFailedMediaAuditFile(path) {
        return new Promise((resolve) => wx.getFileSystemManager().unlink({ filePath: path, success: resolve, fail: resolve }));
      }, localPath).catch(() => null);
    }
    throw error;
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
