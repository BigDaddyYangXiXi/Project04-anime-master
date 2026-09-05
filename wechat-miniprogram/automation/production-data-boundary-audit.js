const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "miniprogram", "pages");
const read = (page) => fs.readFileSync(path.join(root, page, "index.js"), "utf8");
const cloudPages = [
  "account-profile", "booking", "booking-status", "brief", "discover", "fulfillment", "me", "me-assets",
  "order-detail", "orders", "project-detail", "projects", "provider-detail", "provider-orders", "provider-profile",
  "provider-request", "provider-reviews", "provider-schedule", "provider-task", "review", "search-results", "work-detail"
];

for (const page of cloudPages) {
  assert.ok(!read(page).includes(".isAvailable()"), `${page} 生产入口不得因云能力探测失败静默回退本地夹具`);
}

const legacyHome = read("provider-home");
const legacyCalendar = read("provider-calendar");
assert.match(legacyHome, /options\.audit === "1"/);
assert.match(legacyHome, /wx\.switchTab\(\{ url: "\/pages\/discover\/index" \}\)/);
assert.match(legacyCalendar, /options\.audit === "1"/);
assert.match(legacyCalendar, /wx\.switchTab\(\{ url: "\/pages\/projects\/index" \}\)/);

const discover = read("discover");
assert.match(discover, /date: this\.auditMode \? "2026-08-16" : tomorrowKey\(\)/);
assert.match(discover, /date: ""/);
assert.match(discover, /function tomorrowKey/);

process.stdout.write(`Production data boundary audit passed: ${cloudPages.length} cloud pages, 2 legacy roots, dynamic booking date\n`);
