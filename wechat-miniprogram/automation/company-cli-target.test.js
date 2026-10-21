const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scriptDir = path.resolve(__dirname, "../scripts");
const source = fs.readFileSync(path.join(scriptDir, "cloudbase-company-cli.js"), "utf8");
function run(overrides = {}, args = ["env:list"]) {
  const os = { homedir: () => "original-home" }; let calls = 0;
  const config = {
    "../project.config.json": { appid: "wxc94e1c1b38944511" },
    "../cloudbaserc.json": { envId: "cloudbase-d2g65rqbvee0bd978" },
    "../miniprogram/config/cloudbase": { env: "cloudbase-d2g65rqbvee0bd978" }, ...overrides
  };
  let error;
  try {
    vm.runInNewContext(source, { __dirname: scriptDir, process:{argv:["node","company-cli",...args]}, require(name) {
      if (name === "./company-deploy-preflight") return require("../scripts/company-deploy-preflight");
      if (name === "os") return os;
      if (name === "path") return path;
      if (name === "@cloudbase/cli/dist/standalone/cli.js") { calls++; return {}; }
      if (config[name]) return config[name];
      throw new Error(`Unexpected dependency: ${name}`);
    } });
  } catch (caught) { error = caught; }
  return { error, calls, home: os.homedir() };
}
test("默认云命令使用公司入口，匹配配置仅加载公司登录目录", () => {
  const scripts = require("../package.json").scripts;
  assert.equal(scripts.cloudbase, "node scripts/cloudbase-company-cli.js");
  assert.equal(scripts["cloudbase:envs"], "node scripts/cloudbase-company-cli.js env:list");
  const result = run();
  assert.equal(result.error, undefined); assert.equal(result.calls, 1);
  assert.equal(result.home, path.resolve(scriptDir, "../.cloudbase-cli-config/company"));
});
test("AppID、云配置或客户端环境错配时，在读取CLI登录配置前停止", () => {
  for (const overrides of [
    { "../project.config.json": { appid: "wrong-app" } },
    { "../cloudbaserc.json": { envId: "wrong-cloud" } },
    { "../miniprogram/config/cloudbase": { env: "wrong-client" } }
  ]) {
    const result = run(overrides);
    assert.match(result.error.message, /mismatch/);
    assert.equal(result.calls, 0); assert.equal(result.home, "original-home");
  }
});


test('invalid deployment stops before selecting login directory or starting the CLI',()=>{
 const result=run({},['fn','deploy','--all']);
 assert.match(result.error.message,/COMPANY_DEPLOY_REQUIRES_EXPLICIT_CONFIG_AND_FUNCTION/);
 assert.equal(result.calls,0);assert.equal(result.home,'original-home');
});
