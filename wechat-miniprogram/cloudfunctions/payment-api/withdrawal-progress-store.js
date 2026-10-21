const { withdrawalProgress } = require('./withdrawal-progress');
const { assertWithdrawalReceiptEvidence } = require('./withdrawal-receipt-evidence');
// Internal read only. Caller must supply trusted provider identity and merchant scope.
async function readWithdrawalProgress(pool, requestId, providerId, config) {
  if (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId)
    || typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(providerId)
    || typeof config?.appid !== 'string' || !config.appid
    || typeof config.platformMchid !== 'string' || !config.platformMchid) throw Error('WITHDRAWAL_INPUT_INVALID');
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    const [[request]] = await connection.execute(`SELECT CAST(approved_net_fen AS CHAR) AS approved_net_fen
      FROM withdrawal_requests WHERE id=? AND provider_id=? AND appid=? AND platform_mchid=?`,
    [requestId, providerId, config.appid, config.platformMchid]);
    if (!request) throw Error('WITHDRAWAL_NOT_FOUND');
    if (request.approved_net_fen === null) {
      await connection.commit();
      return { requestId, status: 'AWAITING_APPROVAL', progress: null, payable: false };
    }
    const [parts] = await connection.execute(`SELECT id,CAST(amount_fen AS CHAR) AS amountFen,status,account_version_id
      FROM withdrawal_bank_payments WHERE withdrawal_id=? ORDER BY id`, [requestId]);
    const progress = withdrawalProgress(request.approved_net_fen, parts);
    await assertWithdrawalReceiptEvidence(connection,requestId,providerId,parts,config);
    await connection.commit();
    return { requestId, status: progress.status, progress, payable: false };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally {
    if (reusable) connection.release(); else connection.destroy();
  }
}
module.exports = { readWithdrawalProgress };
