const assert = require("node:assert/strict"); const fs = require("node:fs"); const path = require("node:path"); const automator = require("miniprogram-automator");
async function main() { const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" }); try {
  const result = await miniProgram.evaluate(async () => (await wx.cloud.callFunction({ name: "saved-items-api", data: { action: "listMine" } })).result);
  if (!result || !result.ok) console.error(JSON.stringify({ scope: "saved-items-read", error: result && result.error || null }));
  assert.equal(result.ok, true); assert.deepEqual(result.data.providerIds, []); assert.deepEqual(result.data.workIds, []);
  assert.equal(Number.isSafeInteger(result.data.receivedProviderFollows), true); assert.equal(result.data.receivedProviderFollows >= 0, true);
  assert.equal(Number.isSafeInteger(result.data.receivedWorkLikes), true); assert.equal(result.data.receivedWorkLikes >= 0, true);
  const artifact = path.resolve(__dirname, "..", ".artifacts", "cloudbase-saved-items-read-runtime.json"); fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, JSON.stringify({ generatedAt: new Date().toISOString(), ...result.data, readOnly: true }, null, 2));
  console.log(`CloudBase saved-items read-only audit passed: received follows=${result.data.receivedProviderFollows}, received work likes=${result.data.receivedWorkLikes}`);
} finally { miniProgram.disconnect(); } }
main().catch((error) => { console.error(error); process.exit(1); });
