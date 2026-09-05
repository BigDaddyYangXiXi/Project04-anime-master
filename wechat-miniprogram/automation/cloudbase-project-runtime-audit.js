const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

async function call(miniProgram, data) {
  return miniProgram.evaluate(async (payload) => {
    const response = await wx.cloud.callFunction({ name: "project-api", data: payload });
    return response.result;
  }, data);
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const artifact = path.resolve(__dirname, "..", ".artifacts", "cloudbase-project-runtime.json");
  try {
    const before = await call(miniProgram, { action: "listProjects" });
    assert.equal(before.ok, true);
    const existingProjectId = process.env.QA_PROJECT_ID;
    const idempotencyKey = `qa-project-${Date.now()}-runtime`;
    const created = existingProjectId
      ? await call(miniProgram, { action: "getProject", projectId: existingProjectId })
      : await call(miniProgram, { action: "createProject", idempotencyKey });
    assert.equal(created.ok, true);
    assert.match(created.data.id, /^prj_[a-f0-9]{32}$/);
    assert.deepEqual(created.data.bookingIds, []);
    console.log(`project version from cloud: ${JSON.stringify(created.data.version)} (${typeof created.data.version})`);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, JSON.stringify({ generatedAt: new Date().toISOString(), projectId: created.data.id, idempotencyKey: existingProjectId ? null : idempotencyKey, completed: false }, null, 2));
    if (!existingProjectId) {
      const repeated = await call(miniProgram, { action: "createProject", idempotencyKey });
      assert.equal(repeated.data.id, created.data.id);
    }
    const saved = await call(miniProgram, {
      action: "saveProject", projectId: created.data.id, expectedVersion: created.data.version,
      project: { title: "QA 云端项目", date: "2026-09-20", city: "杭州", cityCode: "330100", location: "QA 场地", description: "仅用于项目云端读写验收，完成后精确清理。", targetAssetIds: [] }
    });
    if (!saved.ok) console.error("saveProject response:", JSON.stringify(saved));
    assert.equal(saved.ok, true);
    assert.equal(saved.data.version, 2);
    const stale = await call(miniProgram, {
      action: "saveProject", projectId: created.data.id, expectedVersion: 1,
      project: { title: "过期页面", date: "2026-09-20", city: "杭州", cityCode: "330100", location: "QA 场地", description: "不得覆盖新版本。", targetAssetIds: [] }
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "VERSION_CONFLICT");
    const read = await call(miniProgram, { action: "getProject", projectId: created.data.id });
    assert.equal(read.data.title, "QA 云端项目");
    fs.writeFileSync(artifact, JSON.stringify({ generatedAt: new Date().toISOString(), projectId: created.data.id, idempotencyKey: existingProjectId ? null : idempotencyKey, countBefore: before.data.projects.length, finalVersion: read.data.version, completed: true }, null, 2));
    console.log(`CloudBase project runtime audit passed: ${created.data.id}, idempotency, save/read and stale-version gate`);
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
