const test = require("node:test");
const assert = require("node:assert/strict");
const { inspect } = require("../scripts/check-release-config");
function config() {
  return { project: { appid: "wxc94e1c1b38944511", miniprogramRoot: "miniprogram/", setting: { urlCheck: true } },
    cloud: { envId: "cloudbase-d2g65rqbvee0bd978" },
    client: { env: "cloudbase-d2g65rqbvee0bd978", enabled: true } };
}
test("preview mode, company identity mismatch and private domain bypass block release configuration", () => {
  const valid = config(); assert.deepEqual(inspect(valid), []);
  const disabled = config(); disabled.client.enabled = false;
  assert.deepEqual(inspect(disabled), ["CLIENT_CLOUD_DISABLED"]);
  const wrong = config(); wrong.project.appid = "old-app"; wrong.client.env = "old-env";
  assert.deepEqual(inspect(wrong), ["APP_ID_MISMATCH", "CLOUD_ENV_MISMATCH"]);
  const bypass = config(); bypass.privateProject = { setting: { urlCheck: false } };
  assert.deepEqual(inspect(bypass), ["DOMAIN_VALIDATION_DISABLED"]);
  const unset = config(); delete unset.project.setting;
  assert.deepEqual(inspect(unset), ["DOMAIN_VALIDATION_DISABLED"]);
});

test("release configuration refuses roots that could include backend code or local credentials", () => {
  for (const root of [undefined, "", ".", "../", "cloudfunctions/", "miniprogram/../", "/miniprogram/", "D:/miniprogram/"]) {
    const value = config(); value.project.miniprogramRoot = root;
    assert.deepEqual(inspect(value), ["MINIPROGRAM_ROOT_MISMATCH"]);
  }
  for (const root of ["miniprogram", "./miniprogram/", "miniprogram\\"]) {
    const value = config(); value.project.miniprogramRoot = root;
    assert.deepEqual(inspect(value), []);
  }
});
