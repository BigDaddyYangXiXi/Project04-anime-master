const test = require("node:test"), assert = require("node:assert/strict");
let page;
global.Page = definition => { page = definition; };
require("../miniprogram/pages/provider-detail/index");
delete global.Page;
const catalog = require("../miniprogram/services/cloud-catalog");
test("provider page and service no longer expose an onboarding application flow", () => {
  assert.equal(page.requestQualificationReview, undefined);
  assert.equal(catalog.getQualification, undefined);
  assert.equal(catalog.submitQualification, undefined);
});
