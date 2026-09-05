const assert = require("node:assert/strict"); const fs = require("node:fs"); const path = require("node:path");
const root = path.resolve(__dirname, "..", "miniprogram"); const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const work = read("pages/work-detail/index.js"); const me = read("pages/me/index.js"); const assets = read("pages/me-assets/index.js"); const client = read("services/cloud-saved-items.js");
assert.match(client, /saved-items-api/); assert.match(client, /listMine/); assert.match(client, /setSaved/);
assert.match(work, /cloudSavedItems\.listMine/); assert.match(work, /setSaved\("PROVIDER"/); assert.match(work, /setSaved\("WORK"/); assert.match(work, /socialPending/);
assert.match(me, /saved\.providerIds\.length/); assert.match(me, /saved\.workIds\.length/);
assert.match(assets, /cloudSavedItems\.listMine/); assert.match(assets, /cloudCatalog\.listProviders/); assert.match(assets, /cloudOrders\.listOrders/);
console.log("Cloud saved-items page audit passed: 12 assertions");
