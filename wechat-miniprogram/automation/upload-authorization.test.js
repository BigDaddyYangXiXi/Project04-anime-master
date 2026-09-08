const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") ? [fullPath] : [];
  });
}

test("upload package does not declare or call an unauthorized fuzzy-location API", () => {
  const appConfig = JSON.parse(source("miniprogram/app.json"));
  assert.equal(appConfig.requiredPrivateInfos, undefined);
  assert.equal(appConfig.permission && appConfig.permission["scope.userFuzzyLocation"], undefined);

  const callers = javascriptFiles(miniprogramRoot).filter((file) => fs.readFileSync(file, "utf8").includes("getFuzzyLocation"));
  assert.deepEqual(callers, []);
});

test("discovery keeps a complete manual-city path while automatic location is unavailable", () => {
  const page = source("miniprogram/pages/discover/index.js");
  const template = source("miniprogram/pages/discover/index.wxml");
  const accountClient = source("miniprogram/services/cloud-account.js");
  const accountCore = source("cloudfunctions/account-api/account-core.js");

  assert.match(page, /cloudAccount\.getDiscoveryPreference\(\)/);
  assert.match(page, /locationState:\s*"manual"/);
  assert.match(page, /选择服务城市后，为你展示当地可合作的人与作品/);
  assert.match(template, /mode="region"[^>]+bindchange="updateCity"/);
  assert.match(page, /applyDiscoveryRegion\(region,\s*!this\.auditMode\)/);
  assert.match(accountClient, /saveDiscoveryPreference\(expectedVersion, region, source = "MANUAL"\)/);
  assert.match(accountCore, /event\.action === "saveDiscoveryPreference"/);
});
