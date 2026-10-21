// Invoked only behind the existing operator-token gate. No SQL from the caller.
async function rdbConnectionTiming(event, sdk) {
  if (typeof event.keepalive !== 'boolean') return { ok: false, code: 'INVALID_PROBE_INPUT' };
  const times = [];
  const credentialTimes = [];
  try {
    const initStarted = Date.now();
    const app = sdk.init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 4000, retries: 0, keepalive: event.keepalive });
    // Observe the existing credential request; do not prefetch, cache or retry it.
    const originalAuth = app.auth;
    app.auth = function (...args) {
      const auth = originalAuth.apply(this, args);
      const originalCredential = auth.getClientCredential;
      return new Proxy(auth, { get(target, key) {
        if (key !== 'getClientCredential') return Reflect.get(target, key);
        return async (...credentialArgs) => {
          const started = Date.now();
          try { return await originalCredential.apply(auth, credentialArgs); }
          finally { credentialTimes.push(Date.now() - started); }
        };
      } });
    };
    const db = app.rdb();
    const initMs = Date.now() - initStarted;
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      const result = await db.from('accounts').select('id').limit(1);
      if (result.error) throw Error('READ_FAILED');
      times.push(Date.now() - started);
    }
    return { ok: true, keepalive: event.keepalive, initMs, times, credentialTimes };
  } catch { return { ok: false, code: 'RDB_PROBE_FAILED', times }; }
}
module.exports = { rdbConnectionTiming };
