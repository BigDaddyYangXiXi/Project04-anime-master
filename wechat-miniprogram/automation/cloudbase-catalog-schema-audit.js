const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.resolve(__dirname, "../database/mysql/0002_catalog_core.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

const requiredTables = [
  "media_assets",
  "provider_profiles",
  "provider_profile_tags",
  "provider_services",
  "works",
  "work_images",
  "work_tags",
  "service_works",
  "provider_pinned_works"
];

const failures = [];
const statements = sql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const table of requiredTables) {
  if (!sql.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``)) {
    failures.push(`缺少表 ${table}`);
  }
}

if (statements.length !== requiredTables.length) {
  failures.push(`预期 ${requiredTables.length} 条建表语句，实际 ${statements.length} 条`);
}

const invariants = [
  ["服务作品关联携带 provider_id", /CREATE TABLE IF NOT EXISTS `service_works`[\s\S]*`provider_id` VARCHAR\(64\) NOT NULL/],
  ["服务作品限制同一商家", /FOREIGN KEY \(`service_id`, `provider_id`\)[\s\S]*REFERENCES `provider_services` \(`id`, `provider_id`\)/],
  ["作品关联限制同一商家", /FOREIGN KEY \(`work_id`, `provider_id`\)[\s\S]*REFERENCES `works` \(`id`, `provider_id`\)/],
  ["置顶作品限制同一商家", /CREATE TABLE IF NOT EXISTS `provider_pinned_works`[\s\S]*FOREIGN KEY \(`work_id`, `provider_id`\)[\s\S]*REFERENCES `works` \(`id`, `provider_id`\)/],
  ["作品最多五张图片", /work_images_sort_check` CHECK \(`sort_order` BETWEEN 0 AND 4\)/],
  ["置顶位置仅一到二", /provider_pinned_works_position_check` CHECK \(`position` BETWEEN 1 AND 2\)/],
  ["所有语句可重复执行", !/CREATE TABLE(?! IF NOT EXISTS)/.test(sql)]
];

for (const [label, matcher] of invariants) {
  const passed = matcher instanceof RegExp ? matcher.test(sql) : matcher;
  if (!passed) failures.push(label);
}

if (failures.length) {
  console.error("目录数据库结构审计失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`目录数据库结构审计通过：${requiredTables.length} 张表，${statements.length} 条幂等建表语句。`);
