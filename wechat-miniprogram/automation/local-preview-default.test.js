const { test } = require('node:test');
const assert = require('node:assert/strict');
const preview = require('../miniprogram/utils/local-preview');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('connected builds never enter fixtures, regardless of version, platform or route parameters', () => {
  const module = { exports: {} };
  let platform, envVersion;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/local-preview.js'), 'utf8'), {
    module,
    require: name => {
      assert.equal(name, '../config/cloudbase');
      return { enabled: true };
    },
    wx: {
      getDeviceInfo: () => ({ platform }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion } })
    }
  });
  for (platform of ['devtools', 'ios', 'android']) {
    for (envVersion of ['develop', 'trial', 'release', undefined]) {
      assert.equal(module.exports.isLocal(), false);
      assert.equal(module.exports.isAudit({ audit: '1' }), false);
      assert.doesNotThrow(() => module.exports.assertCloudAllowed());
    }
  }
});

test('fresh simulator skips login, unidentified real-device builds retain authentication', () => {
  let platform = 'devtools', stored = '';
  global.wx = { getDeviceInfo: () => ({ platform }), getStorageSync: () => stored };
  try {
    assert.equal(preview.isLocal(), true);
    assert.throws(() => preview.assertCloudAllowed(), { code: 'LOCAL_PREVIEW_ONLY' });
    stored = false;
    assert.equal(preview.isLocal(), true, 'stale audit cleanup must not restore login');
    for (platform of ['ios', 'android']) {
      stored = true;
      assert.equal(preview.isLocal(), false);
    }
  } finally { delete global.wx; }
});

test('iOS and Android development/trial previews skip login even with stale storage; release stays authenticated', () => {
  let platform, envVersion;
  global.wx = {
    getDeviceInfo: () => ({ platform }),
    getStorageSync: () => false,
    getAccountInfoSync: () => ({ miniProgram: { envVersion } })
  };
  try {
    for (platform of ['ios', 'android']) {
      for (envVersion of ['develop', 'trial']) {
        assert.equal(preview.isLocal(), true);
        assert.equal(preview.isAudit(), true);
        assert.throws(() => preview.assertCloudAllowed(), { code: 'LOCAL_PREVIEW_ONLY' });
      }
      envVersion = 'release';
      assert.equal(preview.isLocal(), false);
      assert.equal(preview.isAudit({ audit: '1' }), false);
    }
  } finally { delete global.wx; }
});

test('release auth rejects audit query and checks the real session', () => {
  global.wx = {
    getDeviceInfo: () => ({ platform: 'ios' }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getStorageSync: () => undefined
  };
  try {
    let page, checked = 0;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/auth/index.js'), 'utf8'), {
      require: name => name.endsWith('local-preview') ? preview : {},
      Page: definition => { page = definition; },
      wx: global.wx
    });
    page.setData = patch => Object.assign(page.data, patch);
    page.checkSession = () => { checked++; };
    page.loadAuditState = () => assert.fail('Release must never load fake account states');
    for (const state of ['register', 'login', 'success', 'loading']) {
      page.onLoad({ audit: '1', state });
      assert.equal(page.auditMode, false);
    }
    assert.equal(checked, 4);
  } finally { delete global.wx; }
});

test('phone preview auth entry goes straight to home without checking a server session', () => {
  let page, destination;
  global.wx = { getDeviceInfo: () => ({ platform: 'ios' }), getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) };
  try {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/auth/index.js'), 'utf8'), {
      require: name => name.endsWith('local-preview') ? preview : {},
      Page: definition => { page = definition; },
      wx: { switchTab: ({ url }) => { destination = url; } }
    });
    page.setData = patch => Object.assign(page.data, patch);
    page.checkSession = () => assert.fail('Preview must not request login');
    page.onLoad({});
    assert.equal(destination, '/pages/discover/index');
  } finally { delete global.wx; }
});
