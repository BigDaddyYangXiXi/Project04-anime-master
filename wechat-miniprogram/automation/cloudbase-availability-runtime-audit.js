const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

async function call(miniProgram, data) {
  return miniProgram.evaluate(async (payload) => {
    const response = await wx.cloud.callFunction({ name: "availability-api", data: payload });
    return response.result;
  }, data);
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const artifact = path.resolve(__dirname, "..", ".artifacts", "cloudbase-availability-runtime.json");
  try {
    const before = await call(miniProgram, { action: "getMine" });
    assert.equal(before.ok, true);
    assert.equal(before.data.version, 0);
    assert.deepEqual(before.data.openDates, []);
    const read = await call(miniProgram, { action: "getPublic", providerId: before.data.providerId });
    assert.equal(read.ok, true);
    assert.equal(read.data.providerId, before.data.providerId);
    assert.deepEqual(read.data.openDates, before.data.openDates);
    assert.deepEqual(read.data.lockedDates, before.data.lockedDates);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, JSON.stringify({ generatedAt: new Date().toISOString(), providerId: before.data.providerId, version: read.data.version, openDates: read.data.openDates, lockedDates: read.data.lockedDates, readOnly: true, completed: true }, null, 2));
    console.log(`CloudBase availability read-only runtime audit passed: ${before.data.providerId}, mine/public consistency`);
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
