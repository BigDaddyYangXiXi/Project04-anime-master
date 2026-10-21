const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
assert.equal(require("../miniprogram/config/cloudbase").enabled, false);
const output = path.resolve(__dirname, "../.artifacts/project-images-20260923");
const key = "animeMasterProjects";
async function run() {
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  const original = await app.callWxMethod("getStorageSync", key);
  const project = { id: "PJ-IMAGE-DISPLAY", title: "目标图片显示验证", date: "2026-09-24", city: "上海", cityCode: "310000",
    location: "展示用地点", description: "检查可用图片与失效图片的位置、删除和返回。", bookingIds: [], targetImages: [], briefSaved: true, projectModelVersion: 2 };
  const assets = [{ assetId: "asset_display_a", fileId: "cloud://display-a", preview: "" },
    { assetId: "asset_display_b", fileId: "cloud://display-b", preview: "" },
    { assetId: "asset_display_c", fileId: "cloud://display-c", preview: "/assets/booking/user.svg" }];
  fs.mkdirSync(output, { recursive: true });
  try {
    await app.callWxMethod("setStorageSync", key, [project]);
    const detail = await app.reLaunch(`/pages/project-detail/index?id=${project.id}&audit=1`);
    await detail.waitFor(700);
    await detail.callMethod("renderProject", { ...project, targetImages: assets.map(item => item.preview), targetImageAssets: assets }, []);
    await app.pageScrollTo(100000); await detail.waitFor(300);
    assert.equal((await detail.$$(".target-images-grid .target-images-empty")).length, 2);
    assert.equal((await detail.$$(".target-images-grid image")).length, 1);
    await app.screenshot({ path: path.join(output, "detail-bottom.png") });
    const brief = await app.navigateTo(`/pages/brief/index?id=${project.id}&audit=1`);
    await brief.waitFor(600);
    await brief.callMethod("renderProject", { ...project, targetImageAssets: assets, targetImages: assets.map(item => item.preview) });
    await app.pageScrollTo(100000); await brief.waitFor(300);
    assert.equal((await brief.$$(".target-editor-item")).length, 3);
    assert.equal((await brief.$$(".target-editor-item .field-hint")).length, 2);
    await app.screenshot({ path: path.join(output, "brief-before-delete.png") });
    await (await brief.$(".remove-target")).tap();
    await brief.waitFor(350);
    const data = await brief.data();
    assert.equal(data.targetAssets.length, 2);
    assert.deepEqual(data.targetImageRows.map(item => item.key), ["asset_display_b", "asset_display_c"]);
    await brief.waitFor(300);
    await app.screenshot({ path: path.join(output, "brief-after-delete.png") });
    await app.navigateBack();
    assert.equal((await app.currentPage()).path, "pages/project-detail/index");
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ detailUnavailable: 2, editorUnavailable: 2, deletionKeepsIdentity: true, back: true, mode: "local display only", realCloudImage: false }, null, 2));
    console.log("Project image display/delete/back runtime audit passed");
  } finally {
    if (original === "") await app.callWxMethod("removeStorageSync", key);
    else await app.callWxMethod("setStorageSync", key, original);
    await app.reLaunch("/pages/discover/index"); app.disconnect();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
