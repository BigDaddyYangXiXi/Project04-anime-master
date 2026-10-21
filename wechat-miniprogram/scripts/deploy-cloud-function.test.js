const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require('node:fs');
const { deploymentCommands, deploymentPlan } = require("./deploy-cloud-function");

test("requires cloud installation when a function has no local runtime dependency", t => {
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', file => String(file).replaceAll('\\', '/').includes('/node_modules/') ? false : exists(file));
  const plan = deploymentPlan("saved-items-api");
  assert.equal(plan.dependencies.includes("@cloudbase/node-sdk"), true);
  assert.equal(plan.missingDependencies.includes("@cloudbase/node-sdk"), true);
  assert.equal(plan.installDependency, true);
});

test("can reuse a complete local dependency tree", t => {
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', file => String(file).replaceAll('\\', '/').includes('/node_modules/') ? true : exists(file));
  const plan = deploymentPlan("media-upload");
  assert.equal(plan.dependencies.includes("@cloudbase/node-sdk"), true);
  assert.deepEqual(plan.missingDependencies, []);
  assert.equal(plan.installDependency, false);
});

test("rejects a function outside cloudbaserc", () => {
  assert.throws(() => deploymentPlan("unknown-function"), /未知云函数/);
});

test("deploys with the current command and then synchronizes the configured runtime", () => {
  const plan = { name: 'project-api', installDependency: true, runtime: 'Nodejs20.19' };
  assert.deepEqual(deploymentCommands(plan), [
    ["fn", "deploy", "project-api", "--force", "--install-dependency", "true", "--json"],
    ["config", "update", "fn", "project-api", "--runtime", "Nodejs20.19", "--json"]
  ]);
});
