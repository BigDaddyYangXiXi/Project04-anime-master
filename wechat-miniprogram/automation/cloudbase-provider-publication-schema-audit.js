const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.resolve(__dirname, "../database/mysql/0005_provider_catalog_publications.sql"),
  "utf8"
);

const checks = [
  ["使用幂等建表", /CREATE TABLE IF NOT EXISTS `provider_catalog_publications`/],
  ["完整目录使用单行 JSON 快照", /`payload` JSON NOT NULL/],
  ["一个服务者只有一个公开快照", /PRIMARY KEY \(`provider_id`\)/],
  ["公开快照归属内部账号", /FOREIGN KEY \(`provider_id`\) REFERENCES `accounts` \(`id`\) ON DELETE CASCADE/],
  ["记录来源草稿版本", /`draft_version` INT NOT NULL/],
  ["公开写入使用乐观版本", /`publication_version` INT NOT NULL DEFAULT 1/],
  ["保留发布时间索引", /KEY `provider_catalog_publications_time_idx` \(`published_at`\)/]
];

const failures = checks.filter(([, matcher]) => !matcher.test(sql)).map(([label]) => label);
if (failures.length) {
  console.error("商家公开目录快照结构审计失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("商家公开目录快照结构审计通过：单行原子可见、账号归属与双版本约束存在。");
