const cloudbase = require("../config/cloudbase");

// Connected builds always use real authentication, including development/trial.
function isLocal() {
  if (cloudbase.enabled) return false;
  if (typeof wx === "undefined") return false;
  const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
  const version = accountInfo.miniProgram && accountInfo.miniProgram.envVersion;
  if (version === "release") return false;
  if (wx.getDeviceInfo && wx.getDeviceInfo().platform === "devtools") {
    // UI review is temporarily always enabled; stale audit cleanup must not restore login.
    return true;
  }
  return version === "develop" || version === "trial";
}

function isAudit() {
  // Route parameters cannot enable fixtures outside a local preview build.
  return isLocal();
}

function assertCloudAllowed() {
  if (!isLocal()) return;
  const error = new Error("当前为本地界面预览，操作不会提交到云端。");
  error.code = "LOCAL_PREVIEW_ONLY";
  throw error;
}

module.exports = { isLocal, isAudit, assertCloudAllowed };
