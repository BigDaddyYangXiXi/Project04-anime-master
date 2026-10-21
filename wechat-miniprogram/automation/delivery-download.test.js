const test = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = value => { definition = value; };
global.wx = { getStorageSync() {}, showToast() {}, downloadFile() {}, previewImage() {}, showModal() {}, shareFileMessage() {}, openDocument() {} };
require("../miniprogram/pages/fulfillment/index");
delete global.Page;
const orders = require("../miniprogram/services/cloud-orders");
function page() {
  return { orderId: "ord_test", data: { order: { deliveryFiles: [{ assetId: "asset_test", fileId: "cloud://private/file" }] }, actionPending: false },
    setData(patch) { Object.assign(this.data, patch); }, openDeliveryFile: definition.openDeliveryFile };
}
test("打开交付图片每次重新鉴权，不缓存私有链接", async t => {
  const p = page(); let checks = 0; let opened = 0;
  t.mock.method(orders, "getDeliveryDownload", async (orderId, assetId) => {
    assert.equal(orderId, "ord_test"); assert.equal(assetId, "asset_test"); checks++;
    return { url: "https://files.example.test/signed", mimeType: "image/jpeg" };
  });
  t.mock.method(wx, "downloadFile", ({ url, success }) => { assert.equal(url, "https://files.example.test/signed"); success({ statusCode: 200, tempFilePath: "tmp.jpg" }); });
  t.mock.method(wx, "previewImage", ({ urls, success }) => { assert.deepEqual(urls, ["tmp.jpg"]); opened++; success(); });
  await p.openDeliveryFile({ currentTarget: { dataset: { index: 0 } } });
  await p.openDeliveryFile({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(checks, 2); assert.equal(opened, 2); assert.equal(p.data.actionPending, false);
});
test("权限拒绝不下载，下载HTTP失败不预览且解除请求锁", async t => {
  const p = page(); let downloads = 0; let previews = 0; let toasts = 0;
  const access = t.mock.method(orders, "getDeliveryDownload", async () => { throw new Error("ORDER_NOT_FOUND"); });
  t.mock.method(wx, "downloadFile", ({ success }) => { downloads++; success({ statusCode: 403, tempFilePath: "error.html" }); });
  t.mock.method(wx, "previewImage", () => { previews++; });
  t.mock.method(wx, "showToast", () => { toasts++; });
  const event = { currentTarget: { dataset: { index: 0 } } };
  await p.openDeliveryFile(event); assert.equal(downloads, 0);
  access.mock.mockImplementation(async () => ({ url: "https://files.example.test/signed", mimeType: "image/jpeg" }));
  await p.openDeliveryFile(event);
  assert.equal(downloads, 1); assert.equal(previews, 0); assert.equal(toasts, 2); assert.equal(p.data.actionPending, false);
});
test("ZIP与TXT经用户确认后转发本地文件，取消不下载", async t => {
  let confirmed = false; let downloads = 0; const shared = [];
  t.mock.method(wx, "showModal", ({ success }) => success({ confirm: confirmed }));
  t.mock.method(wx, "downloadFile", ({ success }) => { downloads++; success({ statusCode: 200, tempFilePath: "local-file" }); });
  t.mock.method(wx, "shareFileMessage", ({ filePath, fileName, success }) => { shared.push({ filePath, fileName }); success(); });
  t.mock.method(wx, "openDocument", () => assert.fail("ZIP/TXT不能当作PDF打开"));
  const access = t.mock.method(orders, "getDeliveryDownload", async () => ({ url: "https://files.example.test/signed", mimeType: "application/zip", name: "交付.zip" }));
  const event = { currentTarget: { dataset: { index: 0 } } };
  const p = page(); await p.openDeliveryFile(event);
  assert.equal(downloads, 0); assert.equal(shared.length, 0); assert.equal(p.data.actionPending, false);
  confirmed = true;
  await p.openDeliveryFile(event);
  access.mock.mockImplementation(async () => ({ url: "https://files.example.test/signed", mimeType: "text/plain", name: "说明.txt" }));
  await p.openDeliveryFile(event);
  assert.deepEqual(shared, [{ filePath: "local-file", fileName: "交付.zip" }, { filePath: "local-file", fileName: "说明.txt" }]);
});
test("PDF指定文档类型，转发取消静默，旧微信提示升级", async t => {
  let toasts = []; let pdf = 0;
  const access = t.mock.method(orders, "getDeliveryDownload", async () => ({ url: "https://files.example.test/signed", mimeType: "application/pdf" }));
  t.mock.method(wx, "downloadFile", ({ success }) => success({ statusCode: 200, tempFilePath: "tmp" }));
  t.mock.method(wx, "openDocument", ({ fileType, success }) => { assert.equal(fileType, "pdf"); pdf++; success(); });
  t.mock.method(wx, "showModal", ({ success }) => success({ confirm: true }));
  t.mock.method(wx, "shareFileMessage", ({ fail }) => fail({ errMsg: "shareFileMessage:fail cancel" }));
  t.mock.method(wx, "showToast", value => toasts.push(value.title));
  const event = { currentTarget: { dataset: { index: 0 } } }; const p = page();
  await p.openDeliveryFile(event); assert.equal(pdf, 1);
  access.mock.mockImplementation(async () => ({ url: "https://files.example.test/signed", mimeType: "text/plain" }));
  await p.openDeliveryFile(event); assert.equal(toasts.length, 0);
  const share = wx.shareFileMessage; wx.shareFileMessage = undefined;
  try { await p.openDeliveryFile(event); assert.deepEqual(toasts, ["请升级微信后转发此文件"]); }
  finally { wx.shareFileMessage = share; }
  assert.equal(p.data.actionPending, false);
});
test("下载中页面卸载，不打开文件或更新已离开页面", async t => {
  const p = page(); let finish;
  t.mock.method(orders, "getDeliveryDownload", async () => ({ url: "https://files.example.test/signed", mimeType: "image/jpeg" }));
  t.mock.method(wx, "downloadFile", ({ success }) => { finish = success; });
  t.mock.method(wx, "previewImage", () => assert.fail("不在离开后打开图片"));
  const run = p.openDeliveryFile({ currentTarget: { dataset: { index: 0 } } });
  await Promise.resolve();
  p.unloaded = true; p.setData = () => assert.fail("不能更新已卸载页面");
  finish({ statusCode: 200, tempFilePath: "tmp" }); await run;
});
