const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const base = require("../cloudbaserc.json");
const appId = require("../project.config.json").appid;
assert.equal(base.envId, "cloudbase-d2g65rqbvee0bd978");
assert.equal(appId, "wxc94e1c1b38944511");
const secretFile = path.join(root, ".cloudbase-cli-config/company-callback-secrets.json");
const configFile = path.join(root, ".cloudbase-cli-config/company-callback-deploy.json");
for (const file of [secretFile, configFile]) execFileSync("git", ["check-ignore", "--quiet", file], { cwd: root });
let secrets;
if (fs.existsSync(secretFile)) {
  secrets = JSON.parse(fs.readFileSync(secretFile, "utf8"));
} else {
  let aesKey;
  do { aesKey = crypto.randomBytes(32).toString("base64").replace(/=$/, ""); } while (!/^[A-Za-z0-9]{43}$/.test(aesKey));
  secrets = { envId: base.envId, WX_APP_ID: appId, WX_CALLBACK_TOKEN: crypto.randomBytes(16).toString("hex"), WX_CALLBACK_AES_KEY: aesKey };
  fs.writeFileSync(secretFile, JSON.stringify(secrets, null, 2), { flag: "wx", mode: 0o600 });
}
assert.equal(secrets.envId, base.envId);
assert.equal(secrets.WX_APP_ID, appId);
assert.match(secrets.WX_CALLBACK_TOKEN, /^[A-Za-z0-9]{3,32}$/);
assert.match(secrets.WX_CALLBACK_AES_KEY, /^[A-Za-z0-9]{43}$/);
const definition = base.functions.find(item => item.name === "wechat-message-callback");
assert.ok(definition && !definition.triggers, "Unexpected callback triggers");
const config = { envId: base.envId, functionRoot: base.functionRoot, functions: [{
  ...definition, envVariables: { WX_APP_ID: appId, WX_CALLBACK_TOKEN: secrets.WX_CALLBACK_TOKEN, WX_CALLBACK_AES_KEY: secrets.WX_CALLBACK_AES_KEY }
}] };
fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log("Company callback config prepared in ignored local files; existing keys preserved; no deployment or public route created.");
