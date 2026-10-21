function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Reads persisted status only. Closing new applications must not hide an existing refund.
async function readRefundRequest(pool, event, caller, config) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID), appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid || appid !== config?.appid) fail('AUTH_CONTEXT_MISSING');
  const byRequest = event && !Object.prototype.hasOwnProperty.call(event, 'refundId');
  const keys = byRequest ? ['action','orderId','paymentId','requestKey'] : ['action','refundId'];
  if (!event || event.action !== 'getRefund' || Object.keys(event).some(key => !keys.includes(key))
    || (byRequest ? typeof event.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event.orderId)
      || typeof event.paymentId !== 'string' || !/^[a-f0-9]{32}$/.test(event.paymentId)
      || typeof event.requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(event.requestKey)
      : typeof event.refundId !== 'string' || !/^[a-f0-9]{32}$/.test(event.refundId))) fail('REFUND_INPUT_INVALID');
  const predicate = byRequest ? 'f.order_id=? AND f.payment_id=? AND f.request_key=?' : 'f.id=?';
  const identity = byRequest ? [event.orderId,event.paymentId,event.requestKey] : [event.refundId];
  const viewer = `(a.id=o.buyer_id AND r.role='BUYER' AND p.payer_openid=w.open_id)${byRequest ? '' : " OR (a.id=o.provider_id AND r.role='PROVIDER')"}`;
  const [[row]] = await pool.execute(`SELECT DISTINCT f.id,f.order_id,f.amount_fen,f.status,f.created_at,f.updated_at,f.succeeded_at
    FROM order_refunds f JOIN order_payments p ON p.id=f.payment_id AND p.order_id=f.order_id
    JOIN order_aggregates o ON o.id=f.order_id JOIN accounts a ON a.status='ACTIVE'
    JOIN account_roles r ON r.account_id=a.id
    JOIN wechat_identities w ON w.account_id=a.id
    WHERE ${predicate} AND w.open_id=? AND (${viewer}) AND p.appid=? AND p.platform_mchid=? AND f.platform_mchid=p.platform_mchid`,
  [...identity, openid, appid, config.platformMchid]);
  if (!row) fail('REFUND_NOT_FOUND');
  return { refundId: row.id, orderId: row.order_id, amountFen: Number(row.amount_fen), status: row.status,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    succeededAt: row.succeeded_at == null ? null : Number(row.succeeded_at) };
}
async function listOrderRefunds(pool, event, caller, config) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID), appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid || appid !== config?.appid) fail('AUTH_CONTEXT_MISSING');
  const cursor = event?.cursor;
  if (!event || event.action !== 'listRefunds' || Object.keys(event).some(key => !['action','orderId','cursor'].includes(key))
    || typeof event.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event.orderId)
    || cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor)
      || Object.keys(cursor).some(key => !['createdAt','id'].includes(key))
      || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt <= 0
      || typeof cursor.id !== 'string' || !/^[a-f0-9]{32}$/.test(cursor.id))) fail('REFUND_INPUT_INVALID');
  const [[owner]] = await pool.execute(`SELECT o.id FROM order_aggregates o
    JOIN accounts a ON a.status='ACTIVE'
    JOIN account_roles r ON r.account_id=a.id AND ((a.id=o.buyer_id AND r.role='BUYER') OR (a.id=o.provider_id AND r.role='PROVIDER'))
    JOIN wechat_identities w ON w.account_id=a.id WHERE o.id=? AND w.open_id=?`, [event.orderId, openid]);
  if (!owner) fail('ORDER_NOT_FOUND');
  const params = [event.orderId, openid, appid, config.platformMchid];
  const after = cursor ? 'AND (f.created_at<? OR (f.created_at=? AND f.id<?))' : '';
  if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  const [rows] = await pool.execute(`SELECT DISTINCT f.id,f.order_id,f.amount_fen,f.status,f.created_at,f.updated_at,f.succeeded_at
    FROM order_refunds f JOIN order_payments p ON p.id=f.payment_id AND p.order_id=f.order_id
    JOIN order_aggregates o ON o.id=f.order_id JOIN accounts a ON a.status='ACTIVE'
    JOIN account_roles r ON r.account_id=a.id JOIN wechat_identities w ON w.account_id=a.id
    WHERE f.order_id=? AND w.open_id=?
      AND ((a.id=o.buyer_id AND r.role='BUYER' AND p.payer_openid=w.open_id) OR (a.id=o.provider_id AND r.role='PROVIDER'))
      AND p.appid=? AND p.platform_mchid=? AND f.platform_mchid=p.platform_mchid
    ${after} ORDER BY f.created_at DESC,f.id DESC LIMIT 21`, params);
  const records = rows.slice(0,20).map(row => ({ refundId: row.id, orderId: row.order_id, amountFen: Number(row.amount_fen),
    status: row.status, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    succeededAt: row.succeeded_at == null ? null : Number(row.succeeded_at) }));
  const last = records[records.length-1];
  return { records, nextCursor: rows.length > 20 ? { createdAt: last.createdAt, id: last.refundId } : null };
}
module.exports = { readRefundRequest, listOrderRefunds };
