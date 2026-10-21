const { calculateOrderAmount } = require('./bank-settlement-amounts');
// Pure settlement calculation. Inputs must be server-verified before any ledger credit.
// Platform costs may be actuals or an explicit reserve; neither reduces provider income.
function calculateSettlementNet(payment, { withholdingFen, platformCostFen } = {}) {
  const amount = calculateOrderAmount(payment);
  for (const value of [withholdingFen, platformCostFen]) {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('SETTLEMENT_COST_OR_TAX_UNCONFIRMED');
  }
  if (withholdingFen > amount.providerPretaxFen) throw Error('SETTLEMENT_WITHHOLDING_EXCEEDS_INCOME');
  return {
    ...amount, withholdingFen, providerNetFen: amount.providerPretaxFen - withholdingFen,
    platformCostFen, platformAfterCostFen: amount.platformFeeFen - platformCostFen
  };
}
module.exports = { calculateSettlementNet };
