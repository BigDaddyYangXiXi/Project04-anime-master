const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const mysql = require("../cloudfunctions/payment-api/node_modules/mysql2/promise");
async function run() {
  const source = path.resolve(process.argv[2] || "");
  const allowed = path.resolve(__dirname, "../.artifacts/company-schema") + path.sep;
  assert.ok(source.startsWith(allowed), "Only local company schema snapshots allowed");
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  assert.equal(manifest.envId, "cloudbase-d2g65rqbvee0bd978");
  const database = `anime_schema_test_${crypto.randomBytes(8).toString("hex")}`;
  const connection = await mysql.createConnection({ host: "127.0.0.1", port: 33317, user: "root", password: "", multipleStatements: true });
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${database}\``); created = true;
    await connection.changeUser({ database });
    await connection.query(fs.readFileSync(path.join(source, "schema.sql"), "utf8"));
    const [tables] = await connection.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?", [database]);
    assert.deepEqual(tables.map(row => row.TABLE_NAME).sort(), [...manifest.tables].sort());
    assert.ok(tables.every(row => row.ENGINE === "InnoDB"));
    const [constraints] = await connection.query("SELECT CONSTRAINT_TYPE, COUNT(*) AS total FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? GROUP BY CONSTRAINT_TYPE", [database]);
    const report = { testedAt: new Date().toISOString(), sourceEnv: manifest.envId, tables: tables.length, constraints,
      scope: "Local schema restoration only; no business rows, cloud snapshot restoration or payment reconciliation tested" };
    fs.writeFileSync(path.join(source, "local-restore-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
}
run().catch(error => { console.error(error.code || "LOCAL_SCHEMA_RESTORE_FAILED"); process.exitCode = 1; });
