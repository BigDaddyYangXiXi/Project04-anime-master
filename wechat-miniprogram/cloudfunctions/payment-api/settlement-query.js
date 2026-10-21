const { callSettlement } = require('./wechat-settlement');
const { recordSettlementResult, reconcileSettlementNotFound } = require('./settlement-store');

// Internal recovery path: querying cannot create a new charge or submit a new split.
async function querySettlement(pool, taskId, config, request, clock = Date.now) {
  if (typeof taskId !== 'string' || !/^[a-f0-9]{32}$/.test(taskId)) {
    const error = new Error('SETTLEMENT_INPUT_INVALID'); error.code = error.message; throw error;
  }
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks WHERE id = ?', [taskId]);
  if (!task) { const error = new Error('SETTLEMENT_NOT_FOUND'); error.code = error.message; throw error; }
  const snapshot = typeof task.request_snapshot === 'string' ? JSON.parse(task.request_snapshot) : task.request_snapshot;
  const result = await callSettlement({ taskId, snapshot }, 'QUERY', config, request, clock);
  if (result.status === 'NOT_FOUND') {
    return reconcileSettlementNotFound(pool, taskId);
  }
  return recordSettlementResult(pool, taskId, result, clock());
}
module.exports = { querySettlement };
