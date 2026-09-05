const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const sql = fs.readFileSync(path.resolve(__dirname, "..", "database", "mysql", "0006_order_aggregates.sql"), "utf8");
assert.match(sql, /CREATE TABLE IF NOT EXISTS `order_aggregates`/);
assert.match(sql, /`payload` JSON NOT NULL/);
assert.match(sql, /UNIQUE KEY `order_aggregates_buyer_idempotency_unique`/);
assert.match(sql, /FOREIGN KEY \(`buyer_id`\) REFERENCES `accounts`/);
assert.match(sql, /FOREIGN KEY \(`provider_id`\) REFERENCES `accounts`/);
assert.match(sql, /CHECK \(`stage` IN \('REQUESTED'/);
assert.match(sql, /CHECK \(`version` >= 1\)/);
assert.doesNotMatch(sql, /OPENID|UNIONID|wechat_ciphertext|phone_ciphertext/i);
console.log("CloudBase order aggregate schema audit passed: atomic row, participants, idempotency and stage/version gates exist");
