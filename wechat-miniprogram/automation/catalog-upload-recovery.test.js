const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const clientPath = require.resolve('../miniprogram/services/cloud-catalog');
const clientRequire = createRequire(clientPath);

async function exercise({ status = 'PENDING_SECURITY_REVIEW', queryFails = false, commitFails = false } = {}) {
  const calls = [];
  const wx = {
    getStorageSync() { return { id: 'upload-owner' }; },
    getImageInfo({ success }) { success({ type: 'png' }); },
    cloud: {
      async uploadFile() { return { fileID: 'cloud://image' }; },
      async callFunction({ data }) {
        calls.push(data.action);
        if (data.action === 'submitImage' || (commitFails && data.action === 'commitUpload')
          || (queryFails && data.action === 'getImageStatus')) throw new Error('response lost');
        return { result: { ok: true, data: data.action === 'prepareUpload'
          ? { assetId: 'asset', cloudPath: 'image' } : { assetId: 'asset', status } } };
      }
    }
  };
  const clientModule = { exports: {} };
  new Function('require', 'module', 'wx', 'getApp', fs.readFileSync(clientPath, 'utf8'))(
    name => name === '../config/cloudbase' ? { enabled: true, env: 'test' }
      : name === '../utils/local-preview' ? { assertCloudAllowed() {} } : clientRequire(name), clientModule, wx, () => ({globalData:{account:{id:'upload-owner'}}}));
  const catalog = clientModule.exports;
    const result = await catalog.uploadImage({ tempFilePath: '/image.png', size: 123 }, 'WORK_IMAGE')
      .then(value => ({ value }), error => ({ error }));
    return { ...result, calls };
}

test('lost review response recovers the existing status without cancellation or resubmission', async () => {
  for (const status of ['PENDING_SECURITY_REVIEW', 'READY', 'REJECTED']) {
    const result = await exercise({ status });
    assert.equal(result.error, undefined);
    assert.equal(result.value.status, status);
    assert.equal(result.value.assetId, 'asset');
    assert.deepEqual(result.calls, ['prepareUpload', 'commitUpload', 'submitImage', 'getImageStatus']);
  }
});

test('unknown review and failed recovery do not delete a possibly active review', async () => {
  const result = await exercise({ queryFails: true });
  assert.equal(result.error.recoverableUpload.assetId, 'asset');
  assert.equal(result.error.recoverableUpload.status, 'PENDING_SECURITY_REVIEW');
  assert.ok(result.error);
  assert.equal(result.value, undefined);
  assert.equal(result.calls.includes('cancelUpload'), false);
});

test('failure before review submission still cleans up the upload', async () => {
  const result = await exercise({ commitFails: true });
  assert.ok(result.error);
  assert.deepEqual(result.calls, ['prepareUpload', 'commitUpload', 'cancelUpload']);
});

test('unrecognized recovery status is not accepted as a successful upload', async () => {
  const result = await exercise({ status: 'UNKNOWN' });
  assert.ok(result.error);
  assert.equal(result.value, undefined);
  assert.equal(result.calls.includes('cancelUpload'), false);
});
