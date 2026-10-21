const readCache = require("./read-cache");
// Diagnose client roundtrips without retaining request/response bodies or identities.
const records = [];
let revision = 0, active = 0;
function label(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "unknown"; }
function call(wxApi, options) { return readCache.run(options, () => request(wxApi, options)); }
async function request(wxApi, options) {
  const startedAt = Date.now(), generation = revision;
  let ok = false, serverTiming;
  active++;
  try {
    const response = await wxApi.cloud.callFunction(options);
    ok = Boolean(response && response.result && response.result.ok);
    const reported = response && response.result && response.result.serverTiming;
    if (reported && typeof reported === "object") {
      const measured = {};
      for (const key of ["sdkLoadMs", "initMs", "readMs"]) {
        if (typeof reported[key] === "number" && Number.isFinite(reported[key]) && reported[key] >= 0) measured[key] = reported[key];
      }
      if (Object.keys(measured).length) serverTiming = measured;
    }
    return response;
  } finally {
    active--;
    if (generation === revision) {
      records.push({ name: label(options.name), action: label(options.data && options.data.action), startedAt,
        milliseconds: Date.now() - startedAt, ok, ...(serverTiming ? { serverTiming } : {}) });
      if (records.length > 100) records.shift();
    }
  }
}
module.exports = { call, isBusy: () => active > 0, read: () => records.map(record => ({ ...record, ...(record.serverTiming ? { serverTiming: { ...record.serverTiming } } : {}) })), clear: () => { readCache.clear(); revision++; records.length = 0; } };
