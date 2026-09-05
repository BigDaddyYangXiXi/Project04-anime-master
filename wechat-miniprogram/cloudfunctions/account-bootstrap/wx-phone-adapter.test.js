const test = require("node:test");
const assert = require("node:assert/strict");
const { createWxPhoneAdapter } = require("./wx-phone-adapter");

test("通过微信官方 OpenAPI 用一次性 code 换取手机号", async () => {
  let input;
  const adapter = createWxPhoneAdapter({ openapi: { phonenumber: { getPhoneNumber: async (value) => {
    input = value;
    return { phoneInfo: { phoneNumber: "13800138000", countryCode: "86" } };
  } } } });
  const result = await adapter.getPhoneNumber("phone-code", "openid-1");
  assert.deepEqual(input, { code: "phone-code", openid: "openid-1" });
  assert.equal(result.phoneNumber, "13800138000");
});

test("拒绝缺失或兑换失败的手机号 code", async () => {
  const adapter = createWxPhoneAdapter({ openapi: { phonenumber: { getPhoneNumber: async () => { throw new Error("denied"); } } } });
  await assert.rejects(() => adapter.getPhoneNumber(""), (error) => error.code === "PHONE_CODE_MISSING");
  await assert.rejects(() => adapter.getPhoneNumber({ code: "bad" }), (error) => error.code === "PHONE_CODE_MISSING");
  await assert.rejects(() => adapter.getPhoneNumber("bad", "openid-1"), (error) => error.code === "PHONE_VERIFICATION_FAILED");
});
