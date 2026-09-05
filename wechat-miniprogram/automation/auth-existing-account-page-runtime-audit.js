const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const output = path.resolve(__dirname, "..", ".artifacts", "auth-page-runtime");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function waitUntil(page, predicate, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const data = await page.data();
    if (predicate(data)) return data;
    await page.waitFor(200);
  }
  throw new Error("auth page state timeout");
}

async function waitForRoute(miniProgram, expected, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const current = await miniProgram.currentPage();
    if (current.path === expected) return current;
    await current.waitFor(200);
  }
  const current = await miniProgram.currentPage();
  const data = current.path === "pages/auth/index" ? await current.data() : {};
  throw new Error(`route timeout: ${current.path} ${JSON.stringify({ processing: data.processing, success: data.success, errorMessage: data.errorMessage })}`);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const exceptions = [];
  const miniProgram = await automator.connect({ wsEndpoint });
  miniProgram.on("exception", (error) => exceptions.push(String(error)));
  try {
    let page = await miniProgram.reLaunch("/pages/auth/index");
    const data = await waitUntil(page, (value) => !value.checking);
    assert.equal(data.errorMessage, "");
    assert.equal(data.mode, "login");
    assert.equal(data.sessionRegistered, true);
    assert.ok(data.account && data.account.id);
    await miniProgram.screenshot({ path: path.join(output, "01-existing-account-login.png") });
    await page.callMethod("submitLogin");
    await waitForRoute(miniProgram, "pages/discover/index");

    await miniProgram.evaluate(function rememberDeepLink() {
      getApp().globalData.pendingRoute = "/pages/provider-detail/index?id=1&workspace=buyer&audit=1";
    });
    page = await miniProgram.reLaunch("/pages/auth/index");
    await waitUntil(page, (value) => !value.checking && value.sessionRegistered);
    await page.callMethod("submitLogin");
    await waitForRoute(miniProgram, "pages/provider-detail/index");
    console.log("Existing-account auth page runtime audit passed: trusted session rendered and login preserved default/deep-link returns");
  } finally {
    miniProgram.disconnect();
  }
  if (exceptions.length) throw new Error(exceptions.join("\n"));
}

main().catch((error) => { console.error(error); process.exit(1); });
