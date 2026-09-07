const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");

const filename = path.resolve(__dirname, "../miniprogram/pages/auth/index.js");
const source = fs.readFileSync(filename, "utf8");
const localRequire = createRequire(filename);

function fixture(respond = () => ({ registered: false })) {
  const calls = [], routes = [], sessions = [], notices = [];
  const wx = {
    cloud: { callFunction: async (request) => {
      calls.push(request);
      return { result: { ok: true, data: await respond(request.data) } };
    } },
    showModal: (value) => notices.push(value),
    reLaunch: ({ url }) => routes.push(url),
    getDeviceInfo: () => ({ platform: "devtools" }),
    canIUse: () => true
  };
  const authFilename = path.resolve(__dirname, "../miniprogram/services/cloud-auth.js");
  const auth = { exports: {} };
  vm.runInNewContext(fs.readFileSync(authFilename, "utf8"), {
    wx, module: auth, require: createRequire(authFilename)
  });
  let definition;
  vm.runInNewContext(source, {
    wx, require: (name) => name === "../../services/cloud-auth" ? auth.exports : localRequire(name),
    Page: (value) => { definition = value; },
    getApp: () => ({ setServerSession: (value) => sessions.push(value), takePostAuthRoute: () => "/pages/orders/index" }),
    setTimeout: (fn) => fn()
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = (patch) => Object.assign(page.data, patch);
  return { page, calls, routes, sessions, notices };
}

test("未注册访客先看到登录入口，读取身份不会创建账号", async () => {
  const { page, calls } = fixture();
  await page.checkSession();
  assert.equal(page.data.mode, "login");
  assert.equal(page.data.sessionRegistered, false);
  assert.deepEqual(calls.map((call) => call.data.action), ["getSession"]);
});

test("注册缺昵称或未同意时不消费手机号凭证，阅读说明不等于同意", async () => {
  const { page, calls, notices } = fixture();
  page.setData({ mode: "register" });
  await page.submitPhone({ detail: { code: "single-use-code" } });
  assert.equal(page.data.fieldError, true);
  page.updateNickname({ detail: { value: "桃桃" } });
  page.preparePhone();
  assert.equal(page.data.noticeError, true);
  page.showNotice();
  assert.equal(notices.length, 1);
  assert.equal(page.data.acceptedNotice, false);
  await page.submitPhone({ detail: { code: "single-use-code" } });
  assert.equal(calls.length, 0);
});

test("原生取消与组件故障区分，均不写入账号", async () => {
  const { page, calls } = fixture();
  await page.submitPhone({ detail: { errMsg: "getRealtimePhoneNumber:fail user deny" } });
  assert.match(page.data.errorMessage, /已取消/);
  page.inDevTools = true;
  await page.submitPhone({ detail: { errMsg: "getRealtimePhoneNumber:fail no permission" } });
  assert.match(page.data.errorMessage, /开发者工具未能/);
  assert.doesNotMatch(page.data.errorMessage, /取消|拒绝/);
  await page.submitPhone({ detail: { code: " " } });
  assert.equal(calls.length, 0);
});

test("手机号登录使用真实服务接口，成功后保存服务端会话并返回原目标页", async () => {
  const session = { account: { id: "server-account", nickname: "桃桃" }, registered: true };
  const { page, calls, sessions, routes } = fixture(() => session);
  await page.submitPhone({ detail: { code: "one-time-code" } });
  assert.equal(calls[0].name, "account-bootstrap");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), { action: "phoneLogin", phoneCode: "one-time-code" });
  assert.equal(sessions[0], session);
  assert.deepEqual(routes, ["/pages/orders/index"]);
  assert.equal(page.data.success, true);
});

test("手机号注册传递昵称和明确同意，不传客户端账号身份", async () => {
  const { page, calls } = fixture(() => ({ created: true, account: { id: "server-account" } }));
  page.setData({ mode: "register" });
  page.updateNickname({ detail: { value: " 桃桃 " } });
  page.toggleNotice();
  await page.submitPhone({ detail: { code: "registration-code" } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), {
    action: "phoneRegister", phoneCode: "registration-code", nickname: "桃桃", acceptedNotice: true
  });
  assert.equal(page.data.successTitle, "账号创建成功");
});

test("请求期间锁定身份方式、昵称和重复提交，失败后保留输入", async () => {
  let reject;
  const pending = new Promise((resolve, fail) => { reject = fail; });
  const { page, calls } = fixture(() => pending);
  page.setData({ mode: "register", nickname: "桃桃", acceptedNotice: true, canRegister: true });
  const submit = page.submitPhone({ detail: { code: "code" } });
  page.updateNickname({ detail: { value: "另一昵称" } });
  page.switchMode({ currentTarget: { dataset: { mode: "login" } } });
  page.toggleNotice();
  await page.submitRegister();
  await page.submitPhone({ detail: { code: "duplicate" } });
  assert.equal(calls.length, 1);
  reject(Object.assign(new Error("unavailable"), { code: "PHONE_VERIFICATION_FAILED" }));
  await submit;
  assert.equal(page.data.processing, false);
  assert.equal(page.data.nickname, "桃桃");
  assert.equal(page.data.mode, "register");
  assert.equal(page.data.acceptedNotice, true);
  assert.equal(page.data.success, false);
  assert.match(page.data.errorMessage, /重新授权/);
});

test("连接失败可以重试，手机号未注册有明确下一步", async () => {
  let attempts = 0;
  const { page } = fixture(({ action }) => {
    if (action === "getSession" && ++attempts === 1) throw new Error("offline");
    if (action === "phoneLogin") throw Object.assign(new Error("missing"), { code: "ACCOUNT_NOT_REGISTERED" });
    return { registered: false };
  });
  await page.checkSession();
  assert.equal(page.data.sessionCheckFailed, true);
  await page.checkSession();
  assert.equal(page.data.sessionCheckFailed, false);
  assert.equal(page.data.errorMessage, "");
  await page.submitPhone({ detail: { code: "code" } });
  assert.equal(page.data.mode, "register");
  assert.equal(page.data.success, false);
});

test("真实云端额度超限显示服务不可用，不伪装成网络故障或保存会话", async () => {
  const { page, sessions } = fixture(() => {
    throw { errCode: -1, errMsg: "cloud.callFunction:fail Error: errCode: -501003 exceed request limit | Request exceeded the limit" };
  });
  await page.checkSession();
  assert.equal(page.data.errorMessage, "登录服务暂不可用，请稍后再来。");
  assert.equal(page.data.sessionCheckFailed, true);
  await page.submitLogin();
  assert.equal(page.data.success, false);
  assert.equal(sessions.length, 0);
  assert.doesNotMatch(page.data.errorMessage, /-501003|额度|网络/);
});
