// Read-only scenario review, never changes the production fee policy.
// All costs must cover the same transaction base and period, after applicable fee reversals.
const categories = ['collection', 'bankPayout', 'verification', 'infrastructure', 'platformTax', 'otherMandatory'];
function fen(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error('COST_AMOUNT_INVALID');
  return BigInt(value);
}
function reviewSettlementCost(input) {
  if (!input || !Number.isInteger(input.proposedBasisPoints) || input.proposedBasisPoints < 0
    || input.proposedBasisPoints > 10000) throw Error('PROPOSED_RATE_INVALID');
  const base = fen(input.transactionBaseFen);
  if (base === 0n) throw Error('POSITIVE_TRANSACTION_BASE_REQUIRED');
  if (input.costs != null && (typeof input.costs !== 'object' || Array.isArray(input.costs)
    || Object.keys(input.costs).some(key => !categories.includes(key)))) throw Error('COST_CATEGORY_INVALID');
  // Validate present entries even if another required cost is still unknown.
  for (const key of categories) if (input.costs?.[key] != null) fen(input.costs[key]);
  const missing = categories.filter(key => input.costs?.[key] == null);
  if (missing.length) return { status: 'COSTS_UNCONFIRMED', missing, minimumBasisPoints: null };
  const total = categories.reduce((sum, key) => sum + fen(input.costs[key]), 0n);
  const fee = (base * BigInt(input.proposedBasisPoints) + 5000n) / 10000n;
  // Conservative percentage ceiling; actual platform fee rounding is also checked above.
  const minimum = (total * 10000n + base - 1n) / base;
  return {
    status: fee < total ? 'BELOW_COST' : fee === total ? 'BREAK_EVEN' : 'ABOVE_COST',
    minimumBasisPoints: String(minimum), proposedBasisPoints: input.proposedBasisPoints,
    transactionBaseFen: String(base), totalCostFen: String(total), platformFeeFen: String(fee),
    platformAfterCostFen: String(fee - total),
    scope: 'SCENARIO_ONLY_NOT_A_UNIVERSAL_RATE_FLOOR'
  };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error('COST_JSON_PATH_REQUIRED');
    const result = reviewSettlementCost(JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
  } catch { console.error('成本测算失败，请检查输入文件、金额和比例；未修改费率。'); process.exitCode = 1; }
}
module.exports = { reviewSettlementCost };
