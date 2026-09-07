const { refreshPayment } = require('./payment-refresh');
let pool;
function unavailable() { const error = new Error('PAYMENT_QUERY_NOT_CONFIGURED'); error.code = error.message; throw error; }
function runtime() {
  let database, config;
  try {
    database = JSON.parse(process.env.PAYMENT_MYSQL_CONFIG || 'null');
    config = JSON.parse(process.env.PAYMENT_WECHAT_CONFIG || 'null');
  } catch { unavailable(); }
  if (!database || !config || typeof config.appid !== 'string' || !config.appid || typeof database.host !== 'string' || !database.host
    || typeof database.database !== 'string' || !database.database || typeof database.user !== 'string' || !database.user
    || typeof database.password !== 'string') unavailable();
  config.publicKeys = new Map(Object.entries(config.publicKeys || {}));
  if (!pool) pool = require('mysql2/promise').createPool({
    host:database.host, port:database.port || 3306, database:database.database, user:database.user, password:database.password,
    ssl:{ rejectUnauthorized:true, verifyIdentity:true, ...(database.ca ? {ca:database.ca} : {}) },
    connectionLimit:4, connectTimeout:5000, supportBigNumbers:true, bigNumberStrings:true,
    multipleStatements:false
  });
  return {pool, config};
}
exports.main = async (event, context) => {
  try {
    const cloudbase = require('@cloudbase/node-sdk');
    const caller = cloudbase.getCloudbaseContext(context);
    const {pool, config} = runtime();
    if ((caller.WX_APPID || caller.APPID) !== config.appid) { const error = new Error('AUTH_CONTEXT_MISSING'); error.code = error.message; throw error; }
    return {ok:true, data:await refreshPayment(pool,event,caller,config)};
  } catch (error) {
    const known = ['AUTH_CONTEXT_MISSING','ACCOUNT_NOT_FOUND','ORDER_NOT_FOUND','PAYMENT_INPUT_INVALID','PAYMENT_IDENTITY_MISMATCH','PAYMENT_QUERY_NOT_CONFIGURED'];
    const code = known.includes(error && error.code) ? error.code : 'PAYMENT_QUERY_FAILED';
    console.error(JSON.stringify({scope:'payment-refresh',code}));
    return {ok:false,error:{code,message:'暂时无法核对付款结果，请稍后重试'}};
  }
};
