const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTarget } = require("./wechat-message-callback-live-audit");
const appId = "wxc94e1c1b38944511";
const base = "https://cloudbase-d2g65rqbvee0bd978.service.tcloudbase.com/wechat-message-callback";
test("callback audit accepts only the explicit company target", () => {
  assert.equal(validateTarget(base, appId).href, base);
  for (const url of ["", base.replace("https:", "http:"), base.replace("cloudbase-d2g65rqbvee0bd978", "quest-band-d1gem4bxt3fa17720"),
    base.replace(".com/", ".com.evil.example/"), base.replace("https://", "https://user:secret@"), `${base}?token=secret`,
    `${base}#fragment`, `${base}/other`, base.replace(".com/", ".com:444/")]) {
    assert.throws(() => validateTarget(url, appId));
  }
  assert.throws(() => validateTarget(base, "wx57412ad07a806b70"));
});
