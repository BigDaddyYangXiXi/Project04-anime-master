const net = require('node:net');
const https = require('node:https');
const { timingSafeEqual } = require('node:crypto');

// Temporary company-environment probe. No credentials, SQL or payment API calls.
function tcpProbe() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '172.17.0.13', port: 3306 });
    const timer = setTimeout(() => finish(false), 5000);
    let finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.destroy(); resolve({ ok });
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function httpsProbe() {
  return new Promise(resolve => {
    const request = https.get({ hostname: 'api.mch.weixin.qq.com', path: '/',
      rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false }, response => {
      const tlsVersion = response.socket.getProtocol();
      const verified = response.socket.authorized === true && ['TLSv1.2', 'TLSv1.3'].includes(tlsVersion);
      response.on('error', () => finish({ ok: false }));
      // Even a 404 proves HTTPS reachability; no payment request is made.
      finish({ ok: verified, statusCode: response.statusCode, tlsVersion });
    });
    let finished = false;
    const timer = setTimeout(() => finish({ ok: false }), 5000);
    function finish(result) {
      if (finished) return;
      finished = true; clearTimeout(timer); request.destroy(); resolve(result);
    }
    request.once('error', error => {
      const allowed = ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET',
        'ETIMEDOUT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'EPROTO'];
      finish({ ok: false, reason: allowed.includes(error.code) ? error.code : 'HTTPS_FAILED' });
    });
  });
}

exports.main = async event => {
  const expected = process.env.NETWORK_PROBE_TOKEN;
  const supplied = event && event.token;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
    || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return { ok: false, code: 'FORBIDDEN' };
  if (process.env.NETWORK_PROBE_MODE === 'public') {
    const paymentHttps = await httpsProbe();
    return { ok: paymentHttps.ok, paymentHttps };
  }
  if (event.action === 'bridge') {
    try {
      const cloud = require('@cloudbase/node-sdk').init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 8000, retries: 0 });
      const reply = await cloud.callFunction({ name: 'network-probe-public', data: { token: expected } });
      const result = reply.result;
      return { ok: result?.ok === true, bridge: result?.ok === true,
        paymentHttps: { ok: result?.paymentHttps?.ok === true,
          tlsVersion: ['TLSv1.2', 'TLSv1.3'].includes(result?.paymentHttps?.tlsVersion)
            ? result.paymentHttps.tlsVersion : null } };
    } catch {
      return { ok: false, code: 'BRIDGE_FAILED' };
    }
  }
  const [databaseTcp, paymentHttps] = await Promise.all([tcpProbe(), httpsProbe()]);
  return { ok: databaseTcp.ok && paymentHttps.ok, databaseTcp, paymentHttps,
    scope: 'Network only; no database login, SQL, payment or business acceptance.' };
};
