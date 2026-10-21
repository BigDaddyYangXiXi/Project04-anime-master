const crypto = require("node:crypto");
const ENV = "cloudbase-d2g65rqbvee0bd978";
let pool;
exports.main = async (event, context) => {
  if (event?.Type === "Timer" && typeof event.Message === "string") event = JSON.parse(event.Message);
  const token = process.env.CONTENT_INTENT_WORKER_TOKEN;
  if (process.env.SCF_NAMESPACE !== ENV || context?.OPENID || context?.WX_OPENID
    || !/^[a-f0-9]{64}$/.test(token || "") || !/^[a-f0-9]{64}$/.test(event?.workerToken || "")
    || !crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(event.workerToken, "hex"))) throw Error("WORKER_FORBIDDEN");
  if (!pool) {
    const config = JSON.parse(Buffer.from(process.env.CONTENT_INTENT_MYSQL_CONFIG_B64 || "", "base64").toString("utf8"));
    if (config.transport !== "company-vpc" || config.host !== "172.17.0.13" || config.database !== ENV
      || config.port && config.port !== 3306 || !config.user || config.user === "root" || typeof config.password !== "string") throw Error("WORKER_CONFIG_INVALID");
    pool = require("mysql2/promise").createPool({ host: config.host, port: 3306, database: ENV, user: config.user,
      password: config.password, connectionLimit: 2, connectTimeout: 5000, multipleStatements: false });
  }
  if (event.mutation) return require("./publication-mutation").mutatePublication(pool, event.mutation);
  if (event.intentId && !/^[a-f0-9]{32}$/.test(event.intentId)) throw Error("WORKER_INPUT_INVALID");
  return event.intentId ? require("./worker-core").applyIntent(pool, event.intentId) : require("./worker-core").drain(pool);
};
