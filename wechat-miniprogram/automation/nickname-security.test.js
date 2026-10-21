const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const base = path.join(__dirname, "../cloudfunctions");
const { checkNickname } = require("../cloudfunctions/account-bootstrap/nickname-security");

test("only an explicit successful pass allows a nickname; failed calls do not expose raw errors", async () => {
  await checkNickname("名字", "trusted", async (request) => {
    assert.deepEqual(request, { content: "名字", nickname: "名字", openid: "trusted", scene: 1, version: 2 });
    return { errCode: 0, result: { suggest: "pass" } };
  });
  for (const [response, code] of [
    [{ errCode: 0, result: { suggest: "risky" } }, "NICKNAME_REJECTED"],
    [{ errcode: 0, result: { suggest: "review" } }, "NICKNAME_REVIEW_REQUIRED"],
    [{ errCode: 500, result: { suggest: "pass" } }, "NICKNAME_CHECK_UNAVAILABLE"],
    [{ result: { suggest: "pass" } }, "NICKNAME_CHECK_UNAVAILABLE"],
    [{ errCode: 0 }, "NICKNAME_CHECK_UNAVAILABLE"],
    [null, "NICKNAME_CHECK_UNAVAILABLE"]
  ]) await assert.rejects(checkNickname("名字", "trusted", async () => response), { code });
  await assert.rejects(checkNickname("名字", "trusted", async () => { throw new Error("private response"); }), { code: "NICKNAME_CHECK_UNAVAILABLE", message: "NICKNAME_CHECK_UNAVAILABLE" });
});

test("independently deployed account functions use identical review logic", () => {
  assert.equal(fs.readFileSync(path.join(base, "account-bootstrap/nickname-security.js"), "utf8"), fs.readFileSync(path.join(base, "account-api/nickname-security.js"), "utf8"));
});

test("registration checks reject risky names before phone consumption or account writes; legacy register stays disabled", async () => {
  const identity = require('../cloudfunctions/account-bootstrap/identity-core');
  for (const action of ["register", "checkRegistration", "phoneRegister"]) {
    let calls = 0, databaseReads = 0, initialized = 0;
    const exports = {};
    const db = {from(table) {
      assert.ok(['wechat_identities','accounts'].includes(table));
      return {select() {return {async eq() {databaseReads++;return {data:[]};}};}};
    }};
    vm.runInNewContext(fs.readFileSync(path.join(base, "account-bootstrap/index.js"), "utf8"), {
      exports, console: { info() {}, error() {} }, process: { env: {} },
      require(name) {
        if (["./identity-core","./account-names","./request-context"].includes(name)) return require(path.join(base,'account-bootstrap',name));
        if (name === "./phone-core") return { registerByPhone: async () => assert.fail('must not create an account') };
        if (name === "./wx-phone-adapter") return { createWxPhoneAdapter: () => assert.fail('must not consume phone authorization') };
        if (name === "./nickname-security") return { reviewNickname: async (nickname, openid) => {
          calls++; assert.equal(nickname, "测试昵称"); assert.equal(openid, "trusted");
          throw Object.assign(new Error("rejected"), { code: "NICKNAME_REJECTED" });
        } };
        if (name === "@cloudbase/node-sdk") return { init: () => {initialized++;return {rdb:()=>db};} };
        throw new Error(`unexpected dependency ${name}`);
      }
    });
    const result = await exports.main({ action, nickname: " 测试昵称 ",username:'test-user', acceptedNotice: true,
      noticeVersion: identity.NOTICE_VERSION, openId: "forged" },
      {environment:JSON.stringify({WX_OPENID:'trusted',WX_APPID:'wxc94e1c1b38944511'})});
    if(action==='register') {
      assert.equal(result.error.code,'PHONE_AUTH_REQUIRED');assert.equal(initialized,0);assert.equal(calls,0);
    } else {
      assert.equal(result.error.code,'NICKNAME_REJECTED');assert.equal(calls,1);assert.equal(databaseReads,3);
    }
  }
});
