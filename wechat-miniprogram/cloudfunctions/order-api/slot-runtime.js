const { confirmWithSlots } = require("./slot-store");
let pool;

module.exports = async function persistConfirmation(row, next) {
  if (!pool) {
    let config;
    try {
      if (process.env.ORDER_MYSQL_CONFIG && process.env.ORDER_MYSQL_CONFIG_B64) throw new Error('Conflicting configuration');
      const value = process.env.ORDER_MYSQL_CONFIG_B64
        ? Buffer.from(process.env.ORDER_MYSQL_CONFIG_B64, 'base64').toString('utf8') : process.env.ORDER_MYSQL_CONFIG;
      config = JSON.parse(value || "null");
    } catch { /* checked below */ }
    if (!config || !["host", "database", "user", "password"].every(key => typeof config[key] === "string")
      || !config.host || !config.database || !config.user) {
      const error = new Error("SLOT_STORE_NOT_CONFIGURED"); error.code = error.message; throw error;
    }
    const privateDatabase = config.transport === 'company-vpc';
    if ((config.transport && !['company-vpc','tls'].includes(config.transport))
      || (privateDatabase && (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978'
        || config.host !== '172.17.0.13' || (config.port !== undefined && config.port !== 3306)
        || config.database !== 'cloudbase-d2g65rqbvee0bd978' || config.user === 'root'))) {
      const error = new Error("SLOT_STORE_NOT_CONFIGURED"); error.code = error.message; throw error;
    }
    pool = require("mysql2/promise").createPool({
      host: config.host, port: config.port || 3306, database: config.database, user: config.user, password: config.password,
      ssl: privateDatabase ? undefined : { rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2', ...(config.ca ? { ca: config.ca } : {}) },
      connectionLimit: 4, connectTimeout: 5000, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false
    });
  }
  return confirmWithSlots(pool, row, next);
};
