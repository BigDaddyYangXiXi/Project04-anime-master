// Isolated candidate only: no credentials, database requests, or OpenAPI calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
try {
  const oldSdk = require('../cloudfunctions/order-api/node_modules/@cloudbase/node-sdk');
  const candidateRoot = '../.artifacts/sdk4-compatibility/node_modules/';
  const candidate = require(candidateRoot + '@cloudbase/node-sdk');
  const wechatSdk = require(candidateRoot + 'wx-server-sdk');
  const fixtures = [{}, { WX_OPENID: 'fixture-openid', WX_APPID: 'fixture-appid' },
    { OPENID: 'fixture-legacy', APPID: 'fixture-legacy-appid' }];
  for (const input of fixtures) {
    const context = { environment: JSON.stringify(input) };
    const previous = oldSdk.getCloudbaseContext(context), current = candidate.getCloudbaseContext(context);
    for (const key of ['WX_OPENID', 'WX_APPID', 'OPENID', 'APPID']) assert.equal(current[key], previous[key]);
  }
  assert.equal(typeof candidate.SYMBOL_CURRENT_ENV, 'symbol');
  const app = candidate.init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 2000, retries: 0 });
  assert.equal(typeof app.callFunction, 'function');
  const table = app.rdb().from('accounts');
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete']) assert.equal(typeof table[method], 'function');
  wechatSdk.init({ env: 'cloudbase-d2g65rqbvee0bd978' });
  assert.equal(typeof wechatSdk.openapi.subscribeMessage.send, 'function');
  assert.equal(typeof wechatSdk.openapi.security.msgSecCheck, 'function');
  const report = { ok: true, checkedAt: new Date().toISOString(), node: process.version,
    cloudbase: require(candidateRoot + '@cloudbase/node-sdk/package.json').version,
    wechat: require(candidateRoot + 'wx-server-sdk/package.json').version,
    fixtureContexts: fixtures.length, databaseRequests: false, openApiCalls: false,
    scope: 'Local import, context parsing fixtures, and method presence only. Not runtime transport, credentials, Node20, or cloud compatibility acceptance.' };
  fs.writeFileSync(path.resolve(__dirname, '../.artifacts/sdk4-compatibility/contract-smoke.json'), JSON.stringify(report, null, 2));
  fs.writeSync(1, JSON.stringify(report) + '\n');
  // SDK initialization may retain handles; this script makes no lifecycle claim.
  process.exit(0);
} catch (_) { fs.writeSync(2, 'SDK4_CONTRACT_SMOKE_FAILED\n'); process.exit(1); }
