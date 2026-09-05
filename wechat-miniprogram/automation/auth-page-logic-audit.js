const assert = require("node:assert/strict");

let pageDefinition;
global.wx = {};
global.getApp = () => ({});
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/auth/index.js");

function create(state) {
  const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
  for (const [key, value] of Object.entries(pageDefinition)) {
    if (key !== "data" && typeof value === "function") page[key] = value.bind(page);
  }
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad({ audit: "1", state });
  return page;
}

const registration = create("register");
registration.submitRegister();
assert.equal(registration.data.errorMessage, "");
assert.equal(registration.data.fieldError, true);
registration.updateNickname({ detail: { value: "  桃桃造型师  " } });
assert.equal(registration.data.nicknameLength, 9);
assert.equal(registration.data.canRegister, false);
registration.toggleNotice();
assert.equal(registration.data.canRegister, true);
registration.submitRegister();
assert.equal(registration.data.success, true);
assert.equal(registration.data.successTitle, "账号创建成功");

const login = create("login");
assert.equal(login.data.sessionRegistered, true);
assert.equal(login.data.account.nickname, "桃桃造型师");
login.submitLogin();
assert.equal(login.data.success, true);

const pending = create("register");
pending.setData({ processing: true });
pending.submitRegister();
assert.equal(pending.data.success, false, "处理中重复点击不得再次提交");

const error = create("error");
assert.match(error.data.errorMessage, /网络开小差/);

console.log("Login and registration page state and interaction audit passed");
