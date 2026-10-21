const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mediaCore = fs.readFileSync(path.join(root, "cloudfunctions/media-upload/media-core.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "database/mysql/0010_media_purpose_and_saved_target_indexes.sql"), "utf8");
const orphanMigration = fs.readFileSync(path.join(root, "database/mysql/0011_ready_media_orphan_quarantine.sql"), "utf8");
const deliveryMigration = fs.readFileSync(path.join(root, "database/mysql/0013_order_delivery_media_assets.sql"), "utf8");
const orphanCore = fs.readFileSync(path.join(root, "cloudfunctions/media-pending-cleanup/ready-orphan-core.js"), "utf8");
const orderCore = fs.readFileSync(path.join(root, "cloudfunctions/order-api/order-core.js"), "utf8");
const orderClient = fs.readFileSync(path.join(root, "miniprogram/services/cloud-orders.js"), "utf8");

assert.match(mediaCore, /owner_account_id: accountId,\s+purpose,\s+scope_id: scopeId,\s+storage_key:/);
assert.match(migration, /ADD COLUMN `purpose` VARCHAR\(32\) NULL/);
assert.match(migration, /MODIFY COLUMN `purpose` VARCHAR\(32\) NOT NULL/);
assert.match(migration, /media_assets_purpose_check/);
assert.match(migration, /media_assets_purpose_status_time_idx/);
for (const purpose of ["AVATAR", "NOTICE_IMAGE", "WORK_IMAGE", "PROJECT_REFERENCE", "PROJECT_TARGET"]) {
  assert.match(migration, new RegExp(`'${purpose}'`));
}
assert.match(orphanMigration, /ORPHAN_CANDIDATE/);
assert.match(orphanMigration, /orphaned_at/);
assert.match(orphanCore, /READY_ORPHAN_TTL_MS = 30/);
assert.match(orphanCore, /ORPHAN_QUARANTINE_MS = 24/);
assert.match(orphanCore, /restore referenced media/);
assert.match(orphanCore, /summary\.deferred \+= 1/);
assert.doesNotMatch(orphanCore, /await deleteFile|status: "DELETED"|status: "ORPHAN_CANDIDATE"/);
assert.match(deliveryMigration, /ADD COLUMN `scope_id` VARCHAR\(64\) NULL/);
assert.match(deliveryMigration, /'ORDER_DELIVERY'/);
assert.match(mediaCore, /DELIVERY_ORDER_STATE_INVALID/);
assert.match(mediaCore, /nextStatus = asset\.purpose === "ORDER_DELIVERY" \? "READY"/);
assert.match(mediaCore, /!\["PENDING", "REJECTED"\]\.includes\(asset\.status\)[\s\S]+MEDIA_STATE_INVALID/);
assert.match(mediaCore, /if \(!item \|\| \(item\.code && item\.code !== "SUCCESS"\)\) fail\("MEDIA_DELETE_FAILED"/);
assert.match(orderCore, /\.eq\("scope_id", orderId\)\.eq\("status", "READY"\)/);
assert.match(orderCore, /assetId: item\.assetId, fileId: item\.fileId/);
assert.match(orphanCore, /\.eq\("provider_id", ownerId\)/);
assert.match(orderClient, /purpose: "ORDER_DELIVERY", scopeId: orderId/);
assert.match(orderClient, /action: "cancelUpload", assetId: item\.assetId/);

console.log("Media purpose audit passed: delivery assets are order-bound; READY reclamation is deferred pending atomic reference protection");
