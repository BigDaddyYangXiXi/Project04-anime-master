const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const envId = require("../cloudbaserc.json").envId;
assert.equal(envId, "cloudbase-d2g65rqbvee0bd978");
assert.equal(require("../project.config.json").appid, "wxc94e1c1b38944511");
function read(sql) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "cloudbase-company-cli.js"), "db", "execute", "--sql", sql, "--json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  });
  if (result.error || result.status !== 0) throw new Error("SCHEMA_READ_FAILED");
  const start = result.stdout.indexOf("{");
  assert.ok(start >= 0);
  return JSON.parse(result.stdout.slice(start)).data.items;
}
try {
  const tables = read("SHOW TABLES").map(row => Object.values(row)[0]).sort();
  assert.ok(tables.length > 0);
  const statements = [];
  for (const name of tables) {
    assert.match(name, /^[a-z][a-z0-9_]*$/);
    const rows = read(`SHOW CREATE TABLE \`${name}\``);
    assert.equal(rows.length, 1);
    const ddl = rows[0]["Create Table"];
    assert.ok(typeof ddl === "string" && ddl.startsWith("CREATE TABLE"));
    statements.push(`${ddl};`);
    console.log(`Schema captured ${statements.length}/${tables.length}: ${name}`);
  }
  const current = read("SHOW TABLES").map(row => Object.values(row)[0]).sort();
  assert.deepEqual(current, tables, "Table inventory changed during capture");
  const directory = path.join(root, ".artifacts", "company-schema", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "schema.sql"), `-- Schema only; no rows, grants, storage or secrets. Restore into an isolated empty database.\nSET FOREIGN_KEY_CHECKS=0;\n${statements.join("\n\n")}\nSET FOREIGN_KEY_CHECKS=1;\n`);
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ envId, capturedAt: new Date().toISOString(), tables,
    scope: "Schema only, sequential capture; not a consistent data backup or restore validation" }, null, 2));
  console.log(`Schema saved: ${directory}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
