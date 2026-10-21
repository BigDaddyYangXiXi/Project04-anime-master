const { MUTATION_RELAY_TIMEOUT_MS } = require('./payment-timeouts');
function failure() { const error = new Error('PAYMENT_RELAY_FAILED'); error.code = error.message; return error; }

async function invokeCompanyRelay(data) {
  const cloud = require('@cloudbase/node-sdk').init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 10000, retries: 0 });
  return cloud.callFunction({ name: 'payment-query-relay', data });
}

async function throughRelay(payload, invoke, statuses, timeout = 10000) {
  let timer;
  try {
    const reply = await Promise.race([
      invoke(payload),
      new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), timeout); })
    ]);
    const result = reply?.result;
    const data = result?.data;
    if (result?.ok !== true || !data || !statuses.includes(data.statusCode)
      || typeof data.bodyBase64 !== 'string' || data.bodyBase64.length > 2796204
      || !data.headers || typeof data.headers !== 'object' || Array.isArray(data.headers)
      || Object.keys(data.headers).length > 100
      || Object.entries(data.headers).some(([key,value]) => typeof value !== 'string' || key.length + value.length > 16384)) throw failure();
    const body = Buffer.from(data.bodyBase64, 'base64');
    if (body.length > 2 * 1024 * 1024 || body.toString('base64') !== data.bodyBase64) throw failure();
    // The caller must verify WeChat's signature before interpreting or persisting any result.
    return { statusCode: data.statusCode, headers: data.headers, body };
  } catch { throw failure(); }
  finally { clearTimeout(timer); }
}

async function queryThroughRelay(options, invoke = invokeCompanyRelay) {
  return throughRelay({ path: options.path, authorization: options.headers.Authorization }, invoke, [200, 404]);
}
async function mutateThroughRelay(options, body, invoke = async data => {
  const cloud = require('@cloudbase/node-sdk').init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: MUTATION_RELAY_TIMEOUT_MS, retries: 0 });
  return cloud.callFunction({ name: 'payment-mutation-relay', data });
}) {
  if (options.method !== 'POST') throw failure();
  return throughRelay({ path: options.path, authorization: options.headers.Authorization, body }, invoke,
    options.path.endsWith('/close') ? [204] : [200], MUTATION_RELAY_TIMEOUT_MS);
}
module.exports = { queryThroughRelay, mutateThroughRelay };
