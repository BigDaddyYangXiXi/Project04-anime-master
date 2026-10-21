const { inTransaction } = require('./payment-store');

// Internal capacity reservation only, not a payout approval or spendable-balance API.
// Live order/hold/ledger review and verified bank details must precede enabling payout.
// No release path: a failed bank attempt still belongs to the same withdrawal request.
async function reserveWithdrawalSources(pool, requestId, sources, config) {
  const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  if (!id(requestId) || !Array.isArray(sources) || !sources.length || sources.length > 100
    || sources.some(s => !s || !id(s.paymentId) || typeof s.amountFen !== 'string'
      || !/^[1-9][0-9]{0,15}$/.test(s.amountFen) || BigInt(s.amountFen) > 9007199254740991n)
    || new Set(sources.map(s => s.paymentId)).size !== sources.length
    || !['appid', 'platformMchid', 'providerId'].every(k => typeof config?.[k] === 'string' && config[k])) {
    throw Error('WITHDRAWAL_SOURCE_INPUT_INVALID');
  }
  const ordered = [...sources].sort((a, b) => a.paymentId.localeCompare(b.paymentId));
  return inTransaction(pool, async connection => {
    const [[request]] = await connection.execute(`SELECT provider_id,CAST(approved_net_fen AS CHAR) AS amount
      FROM withdrawal_requests WHERE id=? AND appid=? AND platform_mchid=? AND provider_id=? FOR UPDATE`,
    [requestId, config.appid, config.platformMchid, config.providerId]);
    if (!request) throw Error('WITHDRAWAL_NOT_FOUND');
    if (request.amount === null) throw Error('WITHDRAWAL_NOT_APPROVED');
    if (ordered.reduce((sum, s) => sum + BigInt(s.amountFen), 0n) !== BigInt(request.amount)) {
      throw Error('WITHDRAWAL_SOURCE_TOTAL_MISMATCH');
    }
    // Every writer must lock the immutable net rows, in the same order, before reading usage.
    const nets = new Map();
    for (const source of ordered) {
      const [[net]] = await connection.execute(`SELECT provider_id,CAST(provider_net_fen AS CHAR) AS amount
        FROM finance_net_settlements WHERE payment_id=? FOR UPDATE`, [source.paymentId]);
      if (!net || net.provider_id !== request.provider_id) throw Error('WITHDRAWAL_SOURCE_NOT_FOUND');
      nets.set(source.paymentId, net);
    }
    const [prior] = await connection.execute(`SELECT payment_id,CAST(amount_fen AS CHAR) AS amount
      FROM withdrawal_sources WHERE withdrawal_id=? ORDER BY payment_id FOR UPDATE`, [requestId]);
    if (prior.length && (prior.length !== ordered.length || prior.some((s, i) =>
      s.payment_id !== ordered[i].paymentId || s.amount !== ordered[i].amountFen))) {
      throw Error('WITHDRAWAL_SOURCE_IDEMPOTENCY_MISMATCH');
    }
    for (const source of ordered) {
      const [[payment]] = await connection.execute(`SELECT id FROM order_payments
        WHERE id=? AND appid=? AND platform_mchid=?`, [source.paymentId, config.appid, config.platformMchid]);
      if (!payment) throw Error('WITHDRAWAL_SOURCE_NOT_FOUND');
      const [used] = await connection.execute(`SELECT withdrawal_id,CAST(amount_fen AS CHAR) AS amount
        FROM withdrawal_sources WHERE payment_id=? ORDER BY withdrawal_id FOR UPDATE`, [source.paymentId]);
      const total = used.reduce((sum, s) => sum + BigInt(s.amount), 0n);
      const addition = prior.length ? 0n : BigInt(source.amountFen);
      if (total + addition > BigInt(nets.get(source.paymentId).amount)) throw Error('WITHDRAWAL_SOURCE_UNAVAILABLE');
    }
    if (!prior.length) for (const source of ordered) {
      await connection.execute('INSERT INTO withdrawal_sources (withdrawal_id,payment_id,amount_fen) VALUES (?,?,?)',
        [requestId, source.paymentId, source.amountFen]);
    }
    return { requestId, alreadyReserved: !!prior.length, payable: false };
  });
}
module.exports = { reserveWithdrawalSources };
