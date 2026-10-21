const test = require("node:test");
const assert = require("node:assert/strict");
const projects = require("../miniprogram/services/cloud-projects");
const previewTargetImage = require("../miniprogram/utils/project-image-preview");
global.wx = { previewImage() {}, showToast() {} };
const event = { currentTarget: { dataset: { index: 0 } } };
function page() {
  return { cloudMode: true, projectId: "p", data: {
    targetAssets: [{ assetId: "a" }, { assetId: "b" }], targetImages: ["old-a", "old-b"]
  }, previewTargetImage };
}
test("project preview refreshes authorization, preserves gallery order and deduplicates taps", async t => {
  const p = page(); global.getCurrentPages = () => [p];
  let resolve; let calls = 0; let shown = 0;
  t.mock.method(projects, "getTargetImages", (id, ids) => {
    assert.equal(id, "p"); assert.deepEqual(ids, ["a", "b"]); calls++;
    return new Promise(done => { resolve = done; });
  });
  t.mock.method(wx, "previewImage", ({ current, urls, success }) => {
    assert.equal(current, "https://test/a"); assert.deepEqual(urls, ["https://test/a", "https://test/b"]); shown++; success();
  });
  for (let i = 0; i < 2; i++) {
    const pending = p.previewTargetImage(event); await p.previewTargetImage(event);
    resolve([{ assetId: "b", url: "https://test/b" }, { assetId: "a", url: "https://test/a" }]); await pending;
  }
  assert.equal(calls, 2); assert.equal(shown, 2);
});
test("removed images and departed pages cannot open late results; unavailable images can retry", async t => {
  const p = page(); let current = p; global.getCurrentPages = () => [current];
  let resolve; let toasts = 0;
  t.mock.method(projects, "getTargetImages", () => new Promise(done => { resolve = done; }));
  t.mock.method(wx, "previewImage", () => assert.fail("must not preview"));
  t.mock.method(wx, "showToast", () => { toasts++; });
  let pending = p.previewTargetImage(event); current = {}; resolve([{ assetId: "a", url: "https://test/a" }]); await pending;
  current = p; pending = p.previewTargetImage(event); p.data.targetAssets = p.data.targetAssets.slice(1); resolve([{ assetId: "a", url: "https://test/a" }]); await pending;
  pending = p.previewTargetImage(event); resolve([{ assetId: "b", url: null }]); await pending;
  assert.equal(toasts, 1); assert.equal(p.targetPreviewPending, false);
});
