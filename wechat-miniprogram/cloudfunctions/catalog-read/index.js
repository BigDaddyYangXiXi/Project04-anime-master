const { readCatalog } = require("./catalog-core");
const { resolveCities } = require("./nearby-cities");

exports.main = async (event) => {
  let stage = "LOAD_SDK";
  const started = Date.now();
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const loaded = Date.now();
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    stage = "INIT_RDB";
    const db = app.rdb();
    const initialized = Date.now();
    stage = "READ_CATALOG";
    const data = await readCatalog(db, event, { resolveCities });
    return { ok: true, data, serverTiming: {
      sdkLoadMs: loaded - started, initMs: initialized - loaded, readMs: Date.now() - initialized
    } };
  } catch (error) {
    const publicCodes = new Set(["INVALID_ACTION", "INVALID_ARGUMENT"]);
    const code = publicCodes.has(error && error.code) ? error.code : "CATALOG_READ_FAILED";
    console.error(JSON.stringify({
      scope: "catalog-read",
      code,
      stage,
      cause: publicCodes.has(code) ? code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        message: code === "CATALOG_READ_FAILED" ? "目录读取失败，请稍后重试" : "请求参数不正确"
      }
    };
  }
};
