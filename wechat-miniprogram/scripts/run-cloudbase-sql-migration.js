const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [envId, migrationFile, account] = process.argv.slice(2);
if (account && account !== "--company") throw new Error("Unknown account option");
if (account === "--company" && envId !== require("../cloudbaserc.json").envId) {
  throw new Error("Company migration must match cloudbaserc.json envId");
}
const cliFile = account === "--company" ? "cloudbase-company-cli.js" : "cloudbase-cli.js";

if (!envId || !migrationFile) {
  console.error("用法：node scripts/run-cloudbase-sql-migration.js <envId> <migration.sql> [--company]");
  process.exit(2);
}

const migrationPath = path.resolve(process.cwd(), migrationFile);
const migrationRoot = `${path.resolve(process.cwd(), "database/mysql")}${path.sep}`;
if (!migrationPath.startsWith(migrationRoot) || path.extname(migrationPath) !== ".sql") {
  console.error("只允许执行 database/mysql 目录中的 .sql 迁移文件");
  process.exit(2);
}

const statements = fs.readFileSync(migrationPath, "utf8")
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const [index, statement] of statements.entries()) {
  const table = statement.match(/CREATE TABLE IF NOT EXISTS `([^`]+)`/i)?.[1] || `语句 ${index + 1}`;
  console.log(`[${index + 1}/${statements.length}] ${table}`);
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, cliFile),
    "db",
    "execute",
    "-e",
    envId,
    "--sql",
    statement,
    "--json"
  ], { stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`迁移完成：${path.basename(migrationPath)}，共 ${statements.length} 条语句。`);
