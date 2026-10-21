function fail() { const error = new Error('PAYMENT_MESSAGE_INVALID'); error.code = error.message; throw error; }
function token(value, max = 128) {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value)) fail();
  return value;
}

// Only called after signature verification (and notification decryption).
function normalizeDirect(transaction, notification = false) {
  const d = transaction;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.sub_orders !== undefined
    || d.combine_mchid !== undefined || !['SUCCESS', 'NOTPAY', 'CLOSED', 'PAYERROR'].includes(d.trade_state)
    || (notification && d.trade_state !== 'SUCCESS')
    || (d.trade_type !== undefined && d.trade_type !== 'JSAPI')) fail();
  const outTradeNo = token(d.out_trade_no, 32);
  const result = { paymentMode: 'DIRECT', outTradeNo,
    // Legacy persistence key denotes the payment reservation id, not a combine channel receipt.
    combineOutTradeNo: outTradeNo, appid: token(d.appid, 32), platformMchid: token(d.mchid, 32),
    subMchid: null, tradeState: d.trade_state };
  if (d.payer?.openid !== undefined) result.payerOpenid = token(d.payer.openid);
  if (d.trade_state !== 'SUCCESS') return result;
  const a = d.amount;
  if (d.trade_type !== 'JSAPI' || !a || !Number.isSafeInteger(a.total) || a.total <= 0
    || !Number.isSafeInteger(a.payer_total) || a.payer_total < 0 || a.payer_total > a.total
    || a.currency !== 'CNY' || a.payer_currency !== 'CNY' || !result.payerOpenid
    || typeof d.success_time !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(d.success_time)) fail();
  const paidAt = Date.parse(d.success_time), zone = d.success_time.slice(-6);
  const offset = d.success_time.endsWith('Z') ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  if (!Number.isSafeInteger(paidAt) || paidAt <= 0
    || new Date(paidAt + offset * 60000).toISOString().slice(0, 19) !== d.success_time.slice(0, 19)) fail();
  return { ...result, transactionId: token(d.transaction_id, 64), totalFen: a.total, payerPaidFen: a.payer_total,
    currency: a.currency, paidAt, payerVerification: 'MATCHED' };
}
module.exports = { normalizeDirect };
