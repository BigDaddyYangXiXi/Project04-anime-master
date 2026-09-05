const { handleAccount } = require("./account-core");
const { resolvedRegion } = require("./location-resolver");

async function resolveRegion(latitude, longitude) {
  const key = String(process.env.TENCENT_MAP_KEY || "").trim();
  if (!key) { const error = new Error("map key is not configured"); error.code = "LOCATION_SERVICE_NOT_CONFIGURED"; throw error; }
  const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${encodeURIComponent(`${latitude},${longitude}`)}&key=${encodeURIComponent(key)}&get_poi=0`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const value = await response.json();
  const region = resolvedRegion(value);
  if (!response.ok || !region) { const error = new Error("location resolution failed"); error.code = "LOCATION_RESOLUTION_FAILED"; throw error; }
  return region;
}

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = cloudbase.getCloudbaseContext(context);
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    return { ok: true, data: await handleAccount(app.rdb(), event, caller, Date.now(), { resolveRegion }) };
  } catch (error) {
    const publicCodes = new Set(["AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR", "VERSION_CONFLICT", "AVATAR_NOT_READY", "LOCATION_SERVICE_NOT_CONFIGURED", "LOCATION_RESOLUTION_FAILED"]);
    const code = publicCodes.has(error && error.code) ? error.code : "ACCOUNT_API_FAILED";
    console.error(JSON.stringify({ scope: "account-api", code, cause: error && error.code || "UNEXPECTED" }));
    return { ok: false, error: { code, message: code === "ACCOUNT_API_FAILED" ? "账号服务暂不可用，请稍后重试" : "账号请求未通过校验" } };
  }
};
