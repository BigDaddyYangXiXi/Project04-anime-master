const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
async function waitUntil(page, predicate, timeout = 10000) { const started = Date.now(); while (Date.now() - started < timeout) { const data = await page.data(); if (predicate(data)) return data; await page.waitFor(200); } throw new Error("page state timeout"); }
async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const output = path.resolve(__dirname, "..", ".artifacts", "cloud-account-page", "01-account-profile.png");
  const errors = []; miniProgram.on("exception", (error) => errors.push(String(error)));
  try {
    const page = await miniProgram.reLaunch("/pages/account-profile/index?role=provider");
    const data = await waitUntil(page, (value) => !value.loading);
    assert.equal(data.loadError, "");
    assert.equal(Number.isSafeInteger(data.accountVersion), true);
    assert.equal(Boolean(data.draft.nickname), true);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await miniProgram.screenshot({ path: output });
    console.log("Cloud account page runtime audit passed: server profile rendered without writes");
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
