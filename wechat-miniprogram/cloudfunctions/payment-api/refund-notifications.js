const { decryptRefundNotification } = require('./wechat-verification');
const { normalizeRefundResult } = require('./wechat-refund');
const { recordRefundResult } = require('./refund-results');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

async function acceptRefundNotification(pool, request, config, now = Date.now()) {
  if (request.method !== 'POST') return { statusCode: 405, body: '' };
  const message = decryptRefundNotification(request.body, request.headers, config, now);
  const data = message.data;
  if (data.mchid !== config.platformMchid || typeof data.out_refund_no !== 'string'
    || !/^[a-f0-9]{32}$/.test(data.out_refund_no)
    || message.eventType !== `REFUND.${data.refund_status}`) fail('REFUND_RESULT_MISMATCH');
  const [[refund]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [data.out_refund_no]);
  if (!refund) fail('REFUND_NOT_FOUND');
  // Notifications use refund_status; queries use status. Both bind to the same immutable refund.
  // WeChat's domestic notification omits currency; use the stored CNY snapshot only when absent.
  const receipt = normalizeRefundResult({ ...data, status: data.refund_status,
    amount: { ...data.amount, currency: data.amount?.currency ?? refund.currency } },
    { ...refund, amount_fen: Number(refund.amount_fen), total_fen: Number(refund.total_fen) }, config, now);
  await recordRefundResult(pool, receipt, now);
  return { statusCode: 204, body: '' };
}
module.exports = { acceptRefundNotification };
