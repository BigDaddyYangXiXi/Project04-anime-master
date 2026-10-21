const { MUTATION_BUDGET_MS } = require('./payment-timeouts');
const { claimSettlement, releaseSettlement, releaseUnsubmittedSettlement, authorizeSettlementSubmission, recordSettlementResult, reconcileSettlementNotFound } = require('./settlement-store');
const { callSettlement } = require('./wechat-settlement');
const { VERSION, platformFee } = require('./fee-policy');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal only. A server-side refund/dispute interlock must be supplied before enabling submission.
// No client RPC route or scheduler is registered for this executor.
async function executeSettlement(pool, orderId, config, checkRisk, channel = callSettlement, clock = Date.now) {
  if (!config || config.settlementExecutionEnabled !== true) return { enabled: false };
  if (config.settlementEnabled !== true || typeof checkRisk !== 'function') fail('SETTLEMENT_EXECUTION_NOT_CONFIGURED');
  const startedAt = clock();
  const claim = await claimSettlement(pool, orderId, startedAt);
  if (claim.status !== 'CLAIMED') return claim;
  let submitted = false;
  try {
    const s = claim.snapshot;
    if (s.appid !== config.appid || s.platformMchid !== config.platformMchid
      || s.feeRuleVersion !== VERSION || s.platformFeeFen !== platformFee(s.totalFen).amountFen) fail('SETTLEMENT_SNAPSHOT_CONFLICT');
    if (claim.nextAction === 'SUBMIT') {
      // Failure/absence of an explicit current risk approval is never interpreted as permission.
      if (await checkRisk(pool, s) !== true) return { status: 'DEFERRED', taskId: claim.taskId };
      const [[ownership]] = await pool.execute('SELECT status,lease_token,lease_until FROM order_settlement_tasks WHERE id=?', [claim.taskId]);
      const beforeSubmit = clock();
      if (!Number.isSafeInteger(beforeSubmit) || beforeSubmit < startedAt || !ownership || ownership.status !== 'PROCESSING'
        || ownership.lease_token !== claim.leaseToken || Number(ownership.lease_until) - beforeSubmit <= MUTATION_BUDGET_MS) {
        return { status: 'DEFERRED', taskId: claim.taskId };
      }
      // Once the fence transaction is attempted, a lost commit reply is an unknown outcome.
      // Keep the durable submission marker unless the transaction explicitly denies permission.
      submitted = true;
      if (!await authorizeSettlementSubmission(pool, orderId, claim.taskId, claim.leaseToken, clock)) {
        submitted = false;
        return { status: 'DEFERRED', taskId: claim.taskId };
      }
      const [[fenced]] = await pool.execute('SELECT status,lease_token,lease_until FROM order_settlement_tasks WHERE id=?', [claim.taskId]);
      const afterFence = clock();
      if (!Number.isSafeInteger(afterFence) || afterFence < startedAt || !fenced || fenced.status !== 'PROCESSING'
        || fenced.lease_token !== claim.leaseToken || Number(fenced.lease_until) - afterFence <= MUTATION_BUDGET_MS) {
        return { status: 'QUERY_REQUIRED', taskId: claim.taskId };
      }
      try { await channel(claim, 'SUBMIT', config, undefined, clock); } catch { /* resolve using the signed query below */ }
    }
    const result = await channel(claim, 'QUERY', config, undefined, clock);
    if (result.status === 'NOT_FOUND') {
      const current = await reconcileSettlementNotFound(pool, claim.taskId);
      return { status: current.status === 'NOT_FOUND' ? 'QUERY_REQUIRED' : current.status, taskId: claim.taskId };
    }
    return { taskId: claim.taskId, ...await recordSettlementResult(pool, claim.taskId, result, clock()) };
  } finally {
    if (claim.nextAction === 'SUBMIT' && !submitted) {
      try { await releaseUnsubmittedSettlement(pool, claim.taskId, claim.leaseToken); } catch { /* preserve unknown marker on storage failure */ }
    }
    try { await releaseSettlement(pool, claim.taskId, claim.leaseToken); } catch { /* expiry permits subsequent reconciliation */ }
  }
}
module.exports = { executeSettlement };
