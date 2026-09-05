const { readCatalog } = require("./catalog-core");

exports.main = async (event) => {
  let stage = "LOAD_SDK";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = "READ_CATALOG";
    const data = await readCatalog(db, event);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set(["INVALID_ACTION", "INVALID_ARGUMENT"]);
    const code = publicCodes.has(error && error.code) ? error.code : "CATALOG_READ_FAILED";
    console.error(JSON.stringify({
      scope: "catalog-read",
      code,
      stage,
      cause: error && error.code ? error.code : "UNEXPECTED"
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
