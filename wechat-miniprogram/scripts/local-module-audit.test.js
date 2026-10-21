const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectLocalModules } = require('./local-module-audit');
test('missing deferred business imports fail even when package dependencies are installed', () => {
  const root = path.resolve(__dirname,'../.artifacts/local-module-audit-tests');
  fs.mkdirSync(root,{recursive:true});
  const dir = fs.mkdtempSync(path.join(root,'case-'));
  try {
    fs.writeFileSync(path.join(dir,'index.js'),"exports.main=()=>require('./refund-results').run();");
    fs.mkdirSync(path.join(dir,'node_modules'));
    assert.deepEqual(inspectLocalModules(dir), ['index.js: missing local module ./refund-results']);
    fs.writeFileSync(path.join(dir,'refund-results.js'),"require('./ledger');");
    assert.deepEqual(inspectLocalModules(dir), ['refund-results.js: missing local module ./ledger']);
    fs.mkdirSync(path.join(dir,'ledger'));fs.writeFileSync(path.join(dir,'ledger/index.js'),'module.exports={}');
    assert.deepEqual(inspectLocalModules(dir), []);
  } finally {
    assert.ok(path.resolve(dir).startsWith(root+path.sep));fs.rmSync(dir,{recursive:true});
  }
});
