const { refreshPayment } = require('./payment-refresh');
const { createPayment } = require('./payment-create');
let pool;
function unavailable() { const error = new Error('PAYMENT_QUERY_NOT_CONFIGURED'); error.code = error.message; throw error; }
function readConfiguration(name) {
  const plain = process.env[name], encoded = process.env[`${name}_B64`];
  if (plain && encoded) unavailable();
  return JSON.parse((encoded ? Buffer.from(encoded, 'base64').toString('utf8') : plain) || 'null');
}
function runtime() {
  let database, config;
  try {
    database = readConfiguration('PAYMENT_MYSQL_CONFIG');
    config = readConfiguration('PAYMENT_WECHAT_CONFIG');
  } catch { unavailable(); }
  if (!database || !config || typeof config.appid !== 'string' || !config.appid || typeof database.host !== 'string' || !database.host
    || typeof database.database !== 'string' || !database.database || typeof database.user !== 'string' || !database.user
    || typeof database.password !== 'string') unavailable();
  config.publicKeys = new Map(Object.entries(config.publicKeys || {}));
  if (typeof config.apiV3Key === 'string') config.apiV3Key = Buffer.from(config.apiV3Key, 'utf8');
  const privateDatabase = database.transport === 'company-vpc';
  if (database.transport && !['company-vpc','tls'].includes(database.transport)) unavailable();
  if (privateDatabase && (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978'
    || database.host !== '172.17.0.13' || (database.port !== undefined && database.port !== 3306)
    || database.database !== 'cloudbase-d2g65rqbvee0bd978' || database.user === 'root')) unavailable();
  if (!pool) pool = require('mysql2/promise').createPool({
    host:database.host, port:database.port || 3306, database:database.database, user:database.user, password:database.password,
    ssl:privateDatabase ? undefined : { rejectUnauthorized:true, verifyIdentity:true, minVersion:'TLSv1.2', ...(database.ca ? {ca:database.ca} : {}) },
    connectionLimit:4, connectTimeout:5000, supportBigNumbers:true, bigNumberStrings:true,
    multipleStatements:false
  });
  return {pool, config};
}
exports.main = async (event, context) => {
  const creating = event && event.action === 'createPayment';
  const refunding = event && ['requestRefund','getRefund','listRefunds'].includes(event.action);
  const readingTax = event && event.action === 'getTaxProfileStatus';
  const submittingTax = event && event.action === 'submitTaxProfile';
  try {
    if (!event || !['createPayment','refreshPayment','requestRefund','getRefund','listRefunds','getTaxProfileStatus','submitTaxProfile'].includes(event.action)) {
      const error = new Error('PAYMENT_INPUT_INVALID'); error.code = error.message; throw error;
    }
    const caller = require('./request-context')(context);
    if (!(caller.WX_OPENID || caller.OPENID) || !(caller.WX_APPID || caller.APPID)) {
      const error = new Error('AUTH_CONTEXT_MISSING'); error.code = error.message; throw error;
    }
    const {pool, config} = runtime();
    if ((caller.WX_APPID || caller.APPID) !== config.appid) { const error = new Error('AUTH_CONTEXT_MISSING'); error.code = error.message; throw error; }
    // wx.cloud.callFunction adds userInfo and tcbContext. Neither is used as identity.
    // Keep every other field so domain handlers still reject unauthorized business overrides.
    const { userInfo, tcbContext, ...request } = event;
    const handle = submittingTax ? require('./tax-submission-handler').submitOwnTaxProfile
      : readingTax ? require('./tax-status-read').readTaxProfileStatus
      : event.action === 'listRefunds' ? require('./refund-read').listOrderRefunds
      : event.action === 'getRefund' ? require('./refund-read').readRefundRequest
      : refunding ? require('./refund-request').createRefundRequest : creating ? createPayment : refreshPayment;
    return {ok:true, data:await handle(pool,request,caller,config)};
  } catch (error) {
    const messages = {
      REFUND_ORDER_COMPLETED:'订单已验收完成，不支持普通退款申请；特殊争议请通过问题反馈提交',
      TAX_SUBMISSION_NOT_ENABLED:'税务资料提交暂未开放',
      TAX_SUBMISSION_NOT_CONFIGURED:'税务资料提交暂未开放',
      TAX_SUBMISSION_INVALID:'请检查资料并确认隐私告知',
      TAX_SUBMISSION_CONFLICT:'提交内容已变化，请重新提交',
      TAX_SUBMISSION_FAILED:'暂时无法提交资料，请稍后重试',
      TAX_STATUS_INPUT_INVALID:'资料查询参数有误',
      TAX_STATUS_NOT_CONFIGURED:'税务资料功能暂未开放',
      TAX_STATUS_READ_FAILED:'暂时无法查询资料状态，请稍后重试',
      REFUND_REQUEST_NOT_ENABLED:'退款申请暂未开放',
      REFUND_NOT_FOUND:'未找到退款记录',
      REFUND_INPUT_INVALID:'请检查退款金额和原因',
      REFUND_AMOUNT_EXCEEDED:'退款金额超过可申请金额，请刷新后重试',
      REFUND_IDEMPOTENCY_CONFLICT:'申请内容已变化，请刷新后重试',
      REFUND_PAYMENT_NOT_READY:'付款状态待核对，暂不能申请退款',
      PAYMENT_PREPAY_NOT_ENABLED:'付款功能暂未开放',
      PAYMENT_STATE_CHANGED:'订单状态已变化，请刷新后重试',
      VERSION_CONFLICT:'订单状态已变化，请刷新后重试',
      AGREEMENT_NOT_CONFIRMED:'请先核对并确认合作信息',
      PAYMENT_CHANNEL_ORDER_NOT_FOUND:'暂未查到微信付款单，请稍后核对；不要重复付款',
      PAYMENT_MERCHANT_NOT_READY:'服务方暂未具备收款条件',
      PAYMENT_ALREADY_EXISTS:'已有付款记录，请先核对付款结果'
    };
    const known = ['AUTH_CONTEXT_MISSING','ACCOUNT_NOT_FOUND','ORDER_NOT_FOUND','PAYMENT_INPUT_INVALID','PAYMENT_IDENTITY_MISMATCH','PAYMENT_QUERY_NOT_CONFIGURED', ...Object.keys(messages)];
    const readingRefund = event && ['getRefund','listRefunds'].includes(event.action);
    const code = known.includes(error && error.code) ? error.code : submittingTax ? 'TAX_SUBMISSION_FAILED' : readingTax ? 'TAX_STATUS_READ_FAILED' : readingRefund ? 'REFUND_READ_FAILED' : refunding ? 'REFUND_REQUEST_FAILED' : creating ? 'PAYMENT_CREATE_FAILED' : 'PAYMENT_QUERY_FAILED';
    console.error(JSON.stringify({scope:submittingTax ? 'tax-submission' : readingTax ? 'tax-status-read' : readingRefund ? 'refund-read' : refunding ? 'refund-request' : creating ? 'payment-create' : 'payment-refresh',code}));
    return {ok:false,error:{code,message:messages[code] || (submittingTax || readingTax ? '暂时无法处理税务资料，请稍后重试' : readingRefund ? '暂时无法查询退款进度，请稍后重试' : refunding ? '暂时无法提交退款申请，请稍后重试' : creating ? '暂时无法发起付款，请稍后重试' : '暂时无法核对付款结果，请稍后重试')}};
  }
};

// HTTP entry: authenticates the original WeChat signature in handlePaymentHttp,
// independently of mini-program RPC identity. A failed setup must request a retry.
async function notify(event, refund = false) {
  const handlers = require('./payment-http');
  const handle = refund ? handlers.handleRefundHttp : handlers.handlePaymentHttp;
  if (!event || event.httpMethod !== 'POST') return handle(null, event, null);
  try {
    const { pool, config } = runtime();
    return await handle(pool, event, config);
  } catch {
    console.error(JSON.stringify({ scope: 'payment-http', code: 'PAYMENT_RUNTIME_UNAVAILABLE' }));
    return { statusCode: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      isBase64Encoded: false, body: JSON.stringify({ code: 'FAIL', message: '通知未处理，请稍后重试' }) };
  }
}
exports.notify = event => notify(event);
exports.refundNotify = event => notify(event, true);

exports.paymentReconcile = (event, context) => require('./payment-worker').runPaymentWorker(
  event, context, process.env, runtime, require('./payment-reconcile').reconcilePayments);

exports.refundOperator = (event, context) => require('./refund-operator').operateRefund(
  event, require('./request-context')(context) || {}, process.env, runtime);

// Separate internal entry, never dispatched by the mini-program RPC handler.
async function refundReconcile(event, context) {
  try {
    const token = process.env.PAYMENT_REFUND_WORKER_TOKEN;
    let request = event;
    if (event?.Type === 'Timer') {
      if (event.TriggerName !== 'refund-reconcile-every-five-minutes'
        || typeof event.Time !== 'string' || !Number.isFinite(Date.parse(event.Time))
        || typeof event.Message !== 'string' || event.Message.length > 256
        || Object.keys(event).some(key => !['Type','TriggerName','Time','Message'].includes(key))) return {ok:false,error:{code:'REFUND_WORKER_FORBIDDEN'}};
      try { request = JSON.parse(event.Message); } catch { return {ok:false,error:{code:'REFUND_WORKER_FORBIDDEN'}}; }
    }
    const supplied = request?.workerToken;
    const caller = require('./request-context')(context) || {};
    if (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978'
      || !/^[a-f0-9]{64}$/.test(token || '') || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
      || caller.WX_OPENID || caller.OPENID || !request || Array.isArray(request) || Object.keys(request).some(key => key !== 'workerToken')
      || !require('node:crypto').timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(supplied,'hex'))) {
      return {ok:false,error:{code:'REFUND_WORKER_FORBIDDEN'}};
    }
    const {pool,config}=runtime();
    return {ok:true,data:await require('./refund-reconcile').reconcileRefunds(pool,config)};
  } catch {
    console.error(JSON.stringify({scope:'refund-worker',code:'REFUND_WORKER_FAILED'}));
    return {ok:false,error:{code:'REFUND_WORKER_FAILED'}};
  }
}

exports.refundReconcile = async (event, context) => {
  const result = await refundReconcile(event, context);
  // Scheduled failures must reach SCF monitoring. Only read-only queries may retry.
  if (event?.Type === 'Timer' && (!result.ok || result.data?.enabled !== true || result.data.failed > 0)) {
    throw new Error('REFUND_WORKER_SCHEDULE_FAILED');
  }
  return result;
};
