const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";
require("./assert-audit-environment")("wx57412ad07a806b70", envId);
const outputPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-media-security-runtime.json");

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  let assetId = "";
  let fileId = "";
  let localPath = "";
  let submitted = false;
  try {
    localPath = await miniProgram.evaluate(function writeSecurityAuditFile() {
      const manager = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/anime-master-security-qa.png`;
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      return new Promise((resolve, reject) => manager.writeFile({
        filePath,
        data: pngBase64,
        encoding: "base64",
        success: () => resolve(filePath),
        fail: reject
      }));
    });

    const prepared = await miniProgram.evaluate(function prepareSecurityAudit(env) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: {
          action: "prepareUpload",
          purpose: "WORK_IMAGE",
          mimeType: "image/png",
          sizeBytes: 68,
          originalFilename: "anime-master-security-qa.png"
        }
      }).then((response) => response.result);
    }, envId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    assetId = prepared.data.assetId;

    const upload = await miniProgram.evaluate(function uploadSecurityAudit(cloudPath, filePath) {
      return wx.cloud.uploadFile({ cloudPath, filePath });
    }, prepared.data.cloudPath, localPath);
    fileId = upload.fileID;

    const committed = await miniProgram.evaluate(function commitSecurityAudit(env, id, cloudFileId) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: { action: "commitUpload", assetId: id, fileId: cloudFileId }
      }).then((response) => response.result);
    }, envId, assetId, fileId);
    assert.equal(committed.ok, true, JSON.stringify(committed.error));
    assert.equal(committed.data.status, "PENDING_SECURITY_REVIEW");

    const security = await miniProgram.evaluate(function submitSecurityAudit(env, id) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-security-submit",
        data: { action: "submitImage", assetId: id }
      }).then((response) => response.result);
    }, envId, assetId);
    assert.equal(security.ok, true, JSON.stringify(security.error));
    assert.equal(security.data.status, "PENDING_SECURITY_REVIEW");
    submitted = true;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({
      checkedAt: new Date().toISOString(),
      assetId,
      status: security.data.status
    }, null, 2));
    console.log(`CloudBase media security submission passed: ${assetId}`);
  } catch (error) {
    if (assetId && !submitted) {
      await miniProgram.evaluate(function cleanupFailedSecurityAudit(env, id, cloudFileId) {
        wx.cloud.init({ env, traceUser: true });
        return wx.cloud.callFunction({
          name: "media-upload",
          data: { action: "cancelUpload", assetId: id, fileId: cloudFileId || undefined }
        }).catch(() => null);
      }, envId, assetId, fileId).catch(() => null);
    }
    throw error;
  } finally {
    if (localPath) {
      await miniProgram.evaluate(function removeSecurityAuditFile(filePath) {
        return new Promise((resolve) => wx.getFileSystemManager().unlink({
          filePath,
          success: resolve,
          fail: resolve
        }));
      }, localPath).catch(() => null);
    }
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
