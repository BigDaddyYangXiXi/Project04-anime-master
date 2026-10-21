const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function runtime(authorized = true, mode, bridgeFailure = false) {
  const calls = [];
  const sandbox = { exports: {}, Buffer, setTimeout, clearTimeout,
    process: { env: { NETWORK_PROBE_TOKEN: 'a'.repeat(64), NETWORK_PROBE_MODE: mode } }, require(name) {
      if (name === '@cloudbase/node-sdk') return { init(config) {
        calls.push(config);
        return { async callFunction(options) {
          calls.push(options);
          if (bridgeFailure) throw new Error('secret upstream details');
          return { result: { ok: true, paymentHttps: { ok: true, tlsVersion: 'TLSv1.2' } } };
        } };
      } };
      if (name === 'node:crypto') return require(name);
      if (name === 'node:net') return { createConnection(options) {
        calls.push(options); const socket = new EventEmitter(); socket.destroy = () => {};
        queueMicrotask(() => socket.emit('connect')); return socket;
      } };
      if (name === 'node:https') return { get(options, callback) {
        calls.push(options); const request = new EventEmitter(); request.destroy = () => {};
        queueMicrotask(() => callback(Object.assign(new EventEmitter(), {
          statusCode: 404, socket: { authorized, getProtocol: () => 'TLSv1.3' }
        }))); return request;
      } };
      throw new Error('Unexpected dependency');
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls };
}
test('unauthorized probes make no network calls', async () => {
  const r = runtime();
  for (const event of [null, {}, { token: 'b'.repeat(64) }, { token: 'a' }]) {
    assert.equal((await r.main(event)).code, 'FORBIDDEN');
  }
  assert.equal(r.calls.length, 0);
});
test('probe uses fixed destinations, verifies HTTPS and does not require a payment API', async () => {
  const r = runtime();
  const result = await r.main({ token: 'a'.repeat(64), host: 'attacker.test', path: '/v3/pay' });
  assert.equal(result.ok, true);
  assert.equal(r.calls[0].host, '172.17.0.13');
  assert.equal(r.calls[1].hostname, 'api.mch.weixin.qq.com');
  assert.equal(r.calls[1].path, '/');
  assert.equal(r.calls[1].rejectUnauthorized, true);
  assert.equal(r.calls[1].minVersion, 'TLSv1.2');
  assert.doesNotMatch(JSON.stringify(result), /aaaa|172\.17/);
});
test('unverified HTTPS is not a successful probe', async () => {
  assert.equal((await runtime(false).main({ token: 'a'.repeat(64) })).ok, false);
});
test('public probe never opens database TCP or recursively invokes a function', async () => {
  const r = runtime(true, 'public');
  assert.equal((await r.main({ token: 'a'.repeat(64), action: 'bridge' })).ok, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].hostname, 'api.mch.weixin.qq.com');
});
test('bridge uses fixed company target, bounds SDK timeout, and redacts failures', async () => {
  const r = runtime();
  assert.equal((await r.main({ token: 'a'.repeat(64), action: 'bridge', name: 'other' })).ok, true);
  assert.equal(r.calls[0].timeout, 8000);
  assert.equal(r.calls[1].name, 'network-probe-public');
  const failed = await runtime(true, undefined, true).main({ token: 'a'.repeat(64), action: 'bridge' });
  assert.equal(failed.code, 'BRIDGE_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /secret|upstream/);
});
