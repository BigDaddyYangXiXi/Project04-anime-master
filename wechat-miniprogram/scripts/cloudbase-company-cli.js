const os = require("os");
const path = require("path");
const project = require("../project.config.json");
const cloud = require("../cloudbaserc.json");
const client = require("../miniprogram/config/cloudbase");

if (project.appid !== "wxc94e1c1b38944511" || cloud.envId !== "cloudbase-d2g65rqbvee0bd978" || client.env !== cloud.envId) {
  throw new Error("Company AppID/environment mismatch; cloud CLI was not started.");
}

require('./company-deploy-preflight').preflight(process.argv.slice(2));
os.homedir = () => path.resolve(__dirname, "..", ".cloudbase-cli-config", "company");
require("@cloudbase/cli/dist/standalone/cli.js");
