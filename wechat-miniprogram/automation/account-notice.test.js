const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const documents = require("../miniprogram/data/account-notice");
function fixture(local, stack = 2) {
  let page; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/pages/account-notice/index.js"), "utf8"), {
    require: (name) => name.includes("local-preview") ? { isLocal: () => local } : documents,
    Page: (value) => { page = value; }, getCurrentPages: () => Array(stack).fill({}),
    wx: { navigateBack: () => calls.push("back"), reLaunch: ({ url }) => calls.push(url), pageScrollTo: ({ selector }) => calls.push(selector) }
  });
  page.data = { ...page.data }; page.setData = (patch) => Object.assign(page.data, patch);
  return { page, calls };
}
test("all builds read the same current agreement regardless of review route parameters", () => {
  const { page } = fixture(false); page.onLoad({ review: "1" });
  assert.equal(page.data.version, "account-use-v5"); assert.deepEqual(page.data.sections, documents.current.sections);
  assert.equal(page.data.version, require("../cloudfunctions/account-bootstrap/identity-core").NOTICE_VERSION);
});
test("current agreement has complete sections and valid contents navigation", () => {
  const { page, calls } = fixture(true); page.onLoad({ review: "1" });
  assert.equal(page.data.version, "account-use-v5"); assert.deepEqual(page.data.sections, documents.current.sections);
  assert.equal(page.data.version, require("../cloudfunctions/account-bootstrap/identity-core").NOTICE_VERSION);
  page.jumpToSection({ currentTarget: { dataset: { index: documents.current.sections.length - 1 } } });
  page.jumpToSection({ currentTarget: { dataset: { index: -1 } } });
  page.jumpToSection({ currentTarget: { dataset: { index: documents.current.sections.length } } });
  for (const section of page.data.sections) { assert.ok(section.title.trim()); assert.ok(section.paragraphs.length); assert.ok(section.paragraphs.every(p => p.trim())); }
  assert.deepEqual(calls, [`#notice-section-${documents.current.sections.length - 1}`]);
});
test("reader returns to the existing form and direct entry falls back to auth", () => {
  const existing = fixture(false); existing.page.goBack(); assert.deepEqual(existing.calls, ["back"]);
  const direct = fixture(false, 1); direct.page.goBack(); assert.deepEqual(direct.calls, ["/pages/auth/index"]);
});
