const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("project loading uses authorized previews while keeping file identity separate", async () => {
  const calls = [];
  const context = vm.createContext({ module: { exports: {} }, require: name => name === "../utils/cloud-call" ? require("../miniprogram/utils/cloud-call") : name.includes("local-preview")
    ? { assertCloudAllowed() {} } : { enabled: true, env: "test" },
  wx: { cloud: { async callFunction({ data }) {
    calls.push(data);
    return { result: { ok: true, data: data.action === "getTargetImages"
      ? { images: [{ assetId: "a", url: "https://test/private" }, { assetId: "b", url: null }] }
      : { id: "p", title: "project", targetImages: [{ assetId: "a", fileId: "cloud://a" }, { assetId: "b", fileId: "cloud://b" }] } } };
  } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../miniprogram/services/cloud-projects.js"), "utf8"), context);
  const project = await context.module.exports.getProject("p");
  assert.deepEqual(Array.from(project.targetImages), ["https://test/private", ""]);
  assert.equal(project.targetImageAssets[0].fileId, "cloud://a");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, "getTargetImages");
  assert.deepEqual(Array.from(calls[1].assetIds), ["a", "b"]);
  assert.equal(JSON.stringify(calls).includes("https://"), false);
});
