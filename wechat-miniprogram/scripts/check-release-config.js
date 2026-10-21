const fs = require("node:fs");
const path = require("node:path");

function inspect({ project, cloud, client, privateProject = {} }) {
  const blockers = [];
  if (project.appid !== "wxc94e1c1b38944511") blockers.push("APP_ID_MISMATCH");
  if (typeof project.miniprogramRoot !== "string" || !/^(?:\.\/)?miniprogram\/?$/.test(project.miniprogramRoot.replace(/\\/g, "/"))) {
    blockers.push("MINIPROGRAM_ROOT_MISMATCH");
  }
  if (cloud.envId !== "cloudbase-d2g65rqbvee0bd978" || client.env !== cloud.envId) blockers.push("CLOUD_ENV_MISMATCH");
  if (client.enabled !== true) blockers.push("CLIENT_CLOUD_DISABLED");
  if (!project.setting || project.setting.urlCheck !== true || privateProject.setting && privateProject.setting.urlCheck === false) {
    blockers.push("DOMAIN_VALIDATION_DISABLED");
  }
  return blockers;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  try {
    const privatePath = path.join(root, "project.private.config.json");
    const blockers = inspect({
      project: require(path.join(root, "project.config.json")),
      cloud: require(path.join(root, "cloudbaserc.json")),
      client: require(path.join(root, "miniprogram/config/cloudbase.js")),
      privateProject: fs.existsSync(privatePath) ? JSON.parse(fs.readFileSync(privatePath, "utf8")) : {}
    });
    console.log(JSON.stringify({ scope: "local-release-configuration", passed: !blockers.length, blockers,
      note: "仅检查本地配置，不代表云服务、备案、支付、真机验收或发布审批完成。" }, null, 2));
    process.exitCode = blockers.length ? 1 : 0;
  } catch (_) {
    console.error("发布配置无法读取，预检未通过。");
    process.exitCode = 1;
  }
}

module.exports = { inspect };
