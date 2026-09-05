const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "database/mysql/0001_identity_core.sql"), "utf8");
const source = fs.readFileSync(path.join(root, "cloudfunctions/account-bootstrap/index.js"), "utf8");

for (const table of ["accounts", "wechat_identities", "account_roles"]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``), true);
}
assert.match(migration, /UNIQUE KEY `wechat_identities_open_id_unique`/);
assert.match(migration, /PRIMARY KEY \(`account_id`, `role`\)/);
assert.match(migration, /CHECK \(`role` IN \('BUYER', 'PROVIDER'\)\)/);
assert.doesNotMatch(source, /data\s*:\s*\{[^}]*OPENID/s);
assert.doesNotMatch(source, /data\s*:\s*\{[^}]*UNIONID/s);

console.log("CloudBase identity schema audit passed");
