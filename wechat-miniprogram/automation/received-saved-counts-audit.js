const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const core = fs.readFileSync(path.join(root, "cloudfunctions/saved-items-api/saved-items-core.js"), "utf8");
const me = fs.readFileSync(path.join(root, "miniprogram/pages/me/index.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "database/mysql/0010_media_purpose_and_saved_target_indexes.sql"), "utf8");

assert.match(core, /receivedProviderFollows/);
assert.match(core, /receivedWorkLikes/);
assert.match(core, /\.eq\("saved", 1\)/);
assert.match(me, /saved\.receivedWorkLikes/);
assert.match(me, /saved\.receivedProviderFollows/);
assert.doesNotMatch(me, /\{ label: "作品被收藏", value: "—" \}/);
assert.doesNotMatch(me, /\{ label: "账号获关注", value: "—" \}/);
assert.match(migration, /account_saved_items_target_saved_idx/);

console.log("Received saved-item aggregate audit passed: 8 assertions");
