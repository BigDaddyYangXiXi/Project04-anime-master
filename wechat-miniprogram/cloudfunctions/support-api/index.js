const { handleSupport } = require('./support-core');
exports.main = async (event, context) => {
  try {
    const caller = require('./request-context')(context);
    if ((caller.WX_APPID || caller.APPID) !== 'wxc94e1c1b38944511' || !(caller.WX_OPENID || caller.OPENID)) throw Object.assign(new Error(), { code: 'AUTH_CONTEXT_MISSING' });
    const sdk = require('@cloudbase/node-sdk'), app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
    return { ok: true, data: await handleSupport(app.rdb(), event || {}, caller) };
  } catch (error) {
    const allowed = ['AUTH_CONTEXT_MISSING', 'ACCOUNT_NOT_FOUND', 'VALIDATION_ERROR', 'ATTACHMENT_NOT_READY', 'REQUEST_NOT_FOUND', 'ORDER_NOT_OWNED', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'REQUEST_CLOSED', 'REQUEST_LIMIT', 'INVALID_ACTION'];
    const code = allowed.includes(error.code) ? error.code : 'SUPPORT_UNAVAILABLE';
    console.error(JSON.stringify({ scope: 'support-api', code }));
    return { ok: false, error: { code, message: '申请服务暂未完成本次请求，请重试或联系开发者。' } };
  }
};
