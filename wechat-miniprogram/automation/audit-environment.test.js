const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const guard = require("./assert-audit-environment");

test("legacy runtime audits stop before connecting or reading prior run artifacts", () => {
  const files = fs.readdirSync(__dirname).filter(file => file.endsWith(".js") && !file.endsWith(".test.js"))
    .filter(file => fs.readFileSync(path.join(__dirname, file), "utf8").includes('const envId = "quest-band-d1gem4bxt3fa17720";'));
  assert.equal(files.length, 9);
  for (const file of files) {
    let effects = 0;
    const context = { process: { env: {} }, __dirname,
      require(name) {
        if (name === "./assert-audit-environment") return guard;
        if (name === "node:fs") return { readFileSync() { effects++; throw new Error("artifact read"); } };
        if (name === "miniprogram-automator") return { connect() { effects++; throw new Error("connection attempted"); } };
        return require(name);
      } };
    assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context), /验收脚本与当前小程序不匹配/, file);
    assert.equal(effects, 0, file);
  }
});

test("audit guard checks project and both environment configurations independently", () => {
  const source = fs.readFileSync(path.join(__dirname, "assert-audit-environment.js"), "utf8");
  for (const mismatch of [null, "project", "cloud", "client"]) {
    const context = { module: { exports: {} }, require(name) {
      if (name === "node:assert/strict") return assert;
      if (name.endsWith("project.config.json")) return { appid: mismatch === "project" ? "other" : "app" };
      if (name.endsWith("cloudbaserc.json")) return { envId: mismatch === "cloud" ? "other" : "env" };
      return { env: mismatch === "client" ? "other" : "env" };
    } };
    vm.runInNewContext(source, context);
    if (mismatch) assert.throws(() => context.module.exports("app", "env"), /不匹配/);
    else context.module.exports("app", "env");
  }
});
