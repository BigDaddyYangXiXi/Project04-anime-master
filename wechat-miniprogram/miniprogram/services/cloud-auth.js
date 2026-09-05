const cloudbase = require("../config/cloudbase");

function isAvailable() {
  return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction);
}

function errorFrom(result) {
  const error = new Error(result && result.error && result.error.message || "账号请求失败，请稍后重试");
  error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED";
  return error;
}

async function call(data) {
  if (!isAvailable()) {
    const error = new Error("当前环境未启用云服务");
    error.code = "CLOUD_UNAVAILABLE";
    throw error;
  }
  const response = await wx.cloud.callFunction({ name: "account-bootstrap", data });
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}

function getSession() { return call({ action: "getSession" }); }
function login() { return call({ action: "login" }); }
function phoneLogin(phoneCode) { return call({ action: "phoneLogin", phoneCode }); }
function register(nickname, acceptedNotice) {
  return call({ action: "register", nickname, acceptedNotice });
}
function phoneRegister(phoneCode, nickname, acceptedNotice) {
  return call({ action: "phoneRegister", phoneCode, nickname, acceptedNotice });
}

module.exports = { getSession, isAvailable, login, phoneLogin, phoneRegister, register };
