const assert = require("node:assert/strict");

module.exports = function assertAuditEnvironment(appId, envId) {
  assert.equal(require("../project.config.json").appid, appId,
    "验收脚本与当前小程序不匹配，已停止，未连接开发工具。");
  assert.equal(require("../cloudbaserc.json").envId, envId,
    "验收脚本与当前云环境不匹配，已停止，未连接开发工具。");
  assert.equal(require("../miniprogram/config/cloudbase").env, envId,
    "验收脚本与客户端环境不匹配，已停止，未连接开发工具。");
};
