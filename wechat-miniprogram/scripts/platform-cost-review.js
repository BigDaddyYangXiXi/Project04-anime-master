const fs = require('node:fs');
const categories = ['channel', 'bank', 'verification', 'platformTax', 'otherMandatory'];
// Amounts cover one common scenario/period, including refunds; never per withdrawal deductions.
function reviewPlatformCost(input, now = Date.now()) {
  if (!input || typeof input.scenario !== 'string' || !input.scenario.trim()
    || !Number.isInteger(input.proposedBps) || input.proposedBps < 0 || input.proposedBps > 10000
    || typeof input.retainedTotalFen !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input.retainedTotalFen)) {
    throw Error('COST_SCENARIO_INVALID');
  }
  const missing = categories.filter(key => {
    const c = input.costs?.[key];
    return !c || typeof c.fen !== 'string' || !/^(0|[1-9][0-9]*)$/.test(c.fen)
      || typeof c.evidenceReference !== 'string' || !c.evidenceReference.trim()
      || !Number.isSafeInteger(c.validFrom) || !Number.isSafeInteger(c.validUntil)
      || c.validFrom > now || c.validUntil <= now;
  });
  const common = { scenario: input.scenario, proposedBps: input.proposedBps,
    scope: 'SCENARIO_ONLY', productionRateChanged: false, evidenceIndependentlyVerified: false };
  if (missing.length) return { ...common, status: 'COST_UNCONFIRMED', missing, coverageBps: null };
  const total = BigInt(input.retainedTotalFen);
  const cost = categories.reduce((sum, key) => sum + BigInt(input.costs[key].fen), 0n);
  // Round up to a basis point for a conservative ratio, not a new fee rounding policy.
  const coverage = total ? (cost * 10000n + total - 1n) / total : null;
  const margin = total * BigInt(input.proposedBps) - cost * 10000n;
  return { ...common, status: !total ? 'NO_RETAINED_REVENUE'
    : margin < 0n ? 'BELOW_SCENARIO_COST' : margin === 0n ? 'AT_SCENARIO_COST' : 'ABOVE_SCENARIO_COST',
  totalCostFen: String(cost), coverageBps: coverage === null ? null : String(coverage),
  roundingAndProfitNotCovered: true };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error('INPUT_FILE_REQUIRED');
    console.log(JSON.stringify(reviewPlatformCost(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2));
  } catch { console.error('成本核算失败：请检查情景文件及金额格式。'); process.exitCode = 1; }
}
module.exports = { reviewPlatformCost };
