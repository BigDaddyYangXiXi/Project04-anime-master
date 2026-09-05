const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.resolve(__dirname, "../database/mysql/0003_provider_catalog_drafts.sql"),
  "utf8"
);

const checks = [
  ["使用幂等建表", /CREATE TABLE IF NOT EXISTS `provider_catalog_drafts`/],
  ["草稿与公开目录分表", /`payload` JSON NOT NULL/],
  ["一个服务者一份草稿", /PRIMARY KEY \(`provider_id`\)/],
  ["草稿归属内部账号", /FOREIGN KEY \(`provider_id`\) REFERENCES `accounts` \(`id`\) ON DELETE CASCADE/],
  ["支持乐观版本", /`version` INT NOT NULL DEFAULT 1/],
  ["版本下限约束", /CHECK \(`version` >= 1\)/]
];

const failures = checks.filter(([, matcher]) => !matcher.test(sql)).map(([label]) => label);
if (failures.length) {
  console.error("商家目录草稿结构审计失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("商家目录草稿结构审计通过：公开数据与编辑草稿隔离，归属和版本约束存在。");
