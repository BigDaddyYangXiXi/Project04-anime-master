const cloudCall = require("../utils/cloud-call");
const { current: accountNotice } = require("../data/account-notice");
const localPreview = require("../utils/local-preview");
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
  let response;
  try {
    localPreview.assertCloudAllowed();
    response = await cloudCall.call(wx, { name: "account-bootstrap", data });
  } catch (cause) {
    const details = String(cause && (cause.errMsg || cause.message) || "");
    if (cause && (cause.code === "EXCEED_REQUEST_LIMIT" || cause.errCode === -501003)
      || /\bEXCEED_REQUEST_LIMIT\b|\bexceed request limit\b|errCode:\s*-501003\b/i.test(details)) {
      const error = new Error("登录服务暂不可用");
      error.code = "AUTH_SERVICE_UNAVAILABLE";
      throw error;
    }
    throw cause;
  }
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}

function getSession() { return call({ action: "getSession" }); }
function login() { return call({ action: "login" }); }
function phoneLogin(phoneCode) { return call({ action: "phoneLogin", phoneCode }); }
function phoneRegister(phoneCode, nickname, username, acceptedNotice) {
  return call({ action: "phoneRegister", phoneCode, nickname, username, acceptedNotice, noticeVersion: accountNotice.version });
}

module.exports = { getSession, isAvailable, login, phoneLogin, phoneRegister };
