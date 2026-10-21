const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const envId = require("../cloudbaserc.json").envId;
assert.equal(envId, "cloudbase-d2g65rqbvee0bd978");
assert.equal(require("../miniprogram/config/cloudbase").env, envId);
assert.equal(require("../project.config.json").appid, "wxc94e1c1b38944511");

function read(args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "cloudbase-company-cli.js"), ...args, "--json"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000
  });
  // Avoid emitting raw SDK errors or credential diagnostics.
  if (result.error || result.status !== 0) throw new Error(`READ_FAILED:${args[0]}:${args[1]}`);
  const output = result.stdout;
  const start = output.indexOf("{");
  assert.ok(start >= 0, "Missing JSON response");
  return JSON.parse(output.slice(start)).data;
}

try {
  const tables = read(["db", "execute", "--sql", "SHOW TABLES"]).items.map(row => Object.values(row)[0]);
  assert.ok(tables.length > 0 && tables.length <= 100, "Unexpected table count; review audit scope");
  assert.equal(new Set(tables).size, tables.length);
  const permissions = read(["api", "tcb", "DescribeResourcePermission", "--body", JSON.stringify({
    EnvId: envId, ResourceType: "table", Resources: tables
  })]).Data;
  assert.equal(permissions.TotalCount, tables.length);
  const rules = permissions.PermissionList;
  assert.deepEqual(rules.map(rule => rule.Resource).sort(), [...tables].sort());
  for (const rule of rules) {
    assert.equal(rule.ResourceType, "table");
    assert.equal(rule.Permission, "ADMINONLY", `Unexpected permission: ${rule.Resource}`);
  }
  const storage = read(["storage", "rules", "get"]);
  assert.equal(storage.acl, "PRIVATE", "Storage must remain private");
  assert.equal(storage.rule, null, "Custom storage rules require separate review");
  console.log(JSON.stringify({ envId, checkedAt: new Date().toISOString(), tables: rules,
    storage: { acl: storage.acl, rule: storage.rule },
    scope: "Management configuration only; not client bypass or two-account runtime verification" }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
