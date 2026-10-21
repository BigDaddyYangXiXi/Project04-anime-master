const { withdrawalProgress } = require('./withdrawal-progress');
const { lockWithdrawalBacking } = require('./withdrawal-backing');
const { assertWithdrawalReceiptEvidence } = require('./withdrawal-receipt-evidence');
// Internal allocation only; deliberately not exposed by an API or authorized for export.
// Verified account checks and another live review at export are required before enabling payout.
async function reserveWithdrawalPayment(pool, input, config) {
  const ids = ['requestId', 'paymentId', 'accountVersionId'];
  if (!input || ids.some(key => typeof input[key] !== 'string' || !/^[a-f0-9]{32}$/.test(input[key]))
    || ['providerId', 'operatorId'].some(key => typeof input[key] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input[key]))
    || typeof input.amountFen !== 'string' || !/^[1-9][0-9]{0,19}$/.test(input.amountFen)
    || typeof config?.appid !== 'string' || !config.appid
    || typeof config.platformMchid !== 'string' || !config.platformMchid) throw Error('WITHDRAWAL_INPUT_INVALID');
  // Immutable discovery only. Revalidated under locks before any allocation or retry response.
  const [bindings] = await pool.execute(`SELECT s.payment_id,p.order_id FROM withdrawal_sources s
    JOIN order_payments p ON p.id=s.payment_id WHERE s.withdrawal_id=?`, [input.requestId]);
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute(`SELECT CAST(approved_net_fen AS CHAR) AS approved_net_fen
      FROM withdrawal_requests WHERE id=? AND provider_id=? AND appid=? AND platform_mchid=? FOR UPDATE`,
    [input.requestId, input.providerId, config.appid, config.platformMchid]);
    if (!request) throw Error('WITHDRAWAL_NOT_FOUND');
    if (request.approved_net_fen === null) throw Error('WITHDRAWAL_NOT_APPROVED');
    await lockWithdrawalBacking(connection, input.requestId, request.approved_net_fen, input.providerId, bindings, config);
    const [parts] = await connection.execute(`SELECT id,CAST(amount_fen AS CHAR) AS amountFen,status,account_version_id,created_by
      FROM withdrawal_bank_payments WHERE withdrawal_id=? ORDER BY id FOR UPDATE`, [input.requestId]);
    const progress = withdrawalProgress(request.approved_net_fen, parts);
    await assertWithdrawalReceiptEvidence(connection,input.requestId,input.providerId,parts,config);
    const previous = parts.find(part => part.id === input.paymentId);
    if (previous) {
      if (previous.amountFen !== input.amountFen || previous.account_version_id !== input.accountVersionId
        || previous.created_by !== input.operatorId) throw Error('WITHDRAWAL_IDEMPOTENCY_MISMATCH');
      await connection.commit();
      return { paymentId: previous.id, status: previous.status, payable: false };
    }
    if (BigInt(input.amountFen) > BigInt(progress.unallocatedFen)) throw Error('WITHDRAWAL_AMOUNT_UNAVAILABLE');
    const now = Date.now();
    await connection.execute(`INSERT INTO withdrawal_bank_payments
      (id,withdrawal_id,amount_fen,status,created_by,account_version_id,evidence_reference,created_at,updated_at)
      VALUES (?,?,?,'RESERVED',?,?,?,?,?)`,
    [input.paymentId, input.requestId, input.amountFen, input.operatorId, input.accountVersionId,
      'reservation:' + input.paymentId, now, now]);
    await connection.commit();
    return { paymentId: input.paymentId, status: 'RESERVED', payable: false };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { reserveWithdrawalPayment };
