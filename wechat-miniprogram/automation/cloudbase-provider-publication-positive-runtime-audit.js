const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const envId = "quest-band-d1gem4bxt3fa17720";
require("./assert-audit-environment")("wx57412ad07a806b70", envId);
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-provider-publication-positive-runtime.json");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function call(miniProgram, name, data) {
  return miniProgram.evaluate(function callCloudFunction(env, functionName, payload) {
    wx.cloud.init({ env, traceUser: true });
    return wx.cloud.callFunction({ name: functionName, data: payload }).then((response) => response.result);
  }, envId, name, data);
}

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  let localPath = "";
  let assetId = "";
  let fileId = "";
  try {
    const current = await call(miniProgram, "provider-catalog-draft", { action: "getDraft" });
    assert.equal(current.ok, true, JSON.stringify(current.error));
    assert.equal(current.data.version, 0, "线上已有草稿，停止以免覆盖用户数据");

    assetId = process.env.QA_ASSET_ID || "";
    fileId = process.env.QA_FILE_ID || "";
    if (!assetId) {
      localPath = await miniProgram.evaluate(function writeQaImage() {
      const filePath = `${wx.env.USER_DATA_PATH}/anime-master-publication-qa.png`;
      const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
        filePath, data, encoding: "base64", success: () => resolve(filePath), fail: reject
      }));
      });

      const prepared = await call(miniProgram, "media-upload", {
        action: "prepareUpload", purpose: "WORK_IMAGE", mimeType: "image/png",
        sizeBytes: 68, originalFilename: "anime-master-publication-qa.png"
      });
      assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
      assetId = prepared.data.assetId;
      const uploaded = await miniProgram.evaluate(function uploadQaImage(cloudPath, filePath) {
        return wx.cloud.uploadFile({ cloudPath, filePath });
      }, prepared.data.cloudPath, localPath);
      fileId = uploaded.fileID;
    }
    const committed = await call(miniProgram, "media-upload", { action: "commitUpload", assetId, fileId });
    assert.equal(committed.ok, true, JSON.stringify(committed.error));
    const currentStatus = await call(miniProgram, "media-security-submit", { action: "getImageStatus", assetId });
    assert.equal(currentStatus.ok, true, JSON.stringify(currentStatus.error));
    let mediaStatus = currentStatus.data.status;
    if (mediaStatus !== "READY") {
      const submitted = await call(miniProgram, "media-security-submit", { action: "submitImage", assetId });
      assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
      mediaStatus = submitted.data.status;
    }
    for (let index = 0; index < 60 && mediaStatus !== "READY"; index += 1) {
      await wait(1000);
      const status = await call(miniProgram, "media-security-submit", { action: "getImageStatus", assetId });
      assert.equal(status.ok, true, JSON.stringify(status.error));
      mediaStatus = status.data.status;
      if (mediaStatus === "REJECTED") break;
    }
    assert.equal(mediaStatus, "READY", `媒体审核未通过：${mediaStatus}`);

    const workIds = ["qa_work_1", "qa_work_2", "qa_work_3"];
    const draft = {
      profile: { career: "摄影", city: "杭州", cityCode: "330100", bio: "发布链路 QA", notice: "仅用于自动化验收", noticeImageAssetId: null, tags: ["QA"] },
      services: [{ id: "qa_service_1", name: "QA 正片服务", priceFen: 100, unit: "套", description: "验证目录发布完整链路", workIds }],
      works: workIds.map((id, index) => ({
        id, title: `QA 作品 ${index + 1}`, subtitle: "自动化验收", priceFen: 100,
        description: "发布后将精确清理", tone: "coral", tags: ["QA"], imageAssetIds: [assetId]
      })),
      pinnedWorkIds: [workIds[0]]
    };
    const saved = await call(miniProgram, "provider-catalog-draft", { action: "saveDraft", expectedVersion: 0, draft });
    assert.equal(saved.ok, true, JSON.stringify(saved.error));
    assert.equal(saved.data.version, 1);
    const published = await call(miniProgram, "provider-catalog-draft", { action: "publishDraft", expectedVersion: 1 });
    assert.equal(published.ok, true, JSON.stringify(published.error));
    const catalog = await call(miniProgram, "catalog-read", { action: "getProvider", providerId: published.data.providerId });
    assert.equal(catalog.ok, true, JSON.stringify(catalog.error));
    assert.equal(catalog.data.provider.works.length, 3);
    assert.deepEqual(catalog.data.provider.works[0].imageAssetIds, [assetId]);
    assert.equal(catalog.data.provider.works[0].imageFileIds.length, 1);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({
      checkedAt: new Date().toISOString(), providerId: published.data.providerId,
      assetId, fileId, draftVersion: saved.data.version,
      publicationVersion: published.data.publicationVersion,
      worksCount: catalog.data.provider.works.length, mediaStatus
    }, null, 2)}\n`);
    console.log(`CloudBase positive publication QA passed: ${published.data.providerId}, publication v${published.data.publicationVersion}`);
  } finally {
    if (localPath) await miniProgram.evaluate(function removeQaFile(filePath) {
      return new Promise((resolve) => wx.getFileSystemManager().unlink({ filePath, success: resolve, fail: resolve }));
    }, localPath).catch(() => null);
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
