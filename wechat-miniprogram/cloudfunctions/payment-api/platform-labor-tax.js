// SAT 2025 No.16 + 2018 No.61, resident platform labor income only.
// Pure preview: caller must verify identity, income classification, tax base and
// same-taxpayer/same-withholding-entity/year totals. Never call with client totals.
const { providerTaxTreatment } = require('./provider-tax-treatment');
const VERSION = 'CN_PLATFORM_RESIDENT_LABOR_2025_16_V1';
const BRACKETS = [
  [3600000n, 3n, 0n], [14400000n, 10n, 252000n],
  [30000000n, 20n, 1692000n], [42000000n, 25n, 3192000n],
  [66000000n, 30n, 5292000n], [96000000n, 35n, 8592000n],
  [null, 45n, 18192000n]
];
function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) throw Error('TAX_AMOUNT_INVALID');
  return BigInt(value);
}
function previewPlatformLaborTax(input = {}) {
  if (input.incomeType !== 'RESIDENT_PLATFORM_LABOR') throw Error('TAX_CLASSIFICATION_UNSUPPORTED');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period || '') || input.period < '2025-10') {
    throw Error('TAX_PERIOD_UNSUPPORTED');
  }
  const month = Number(input.period.slice(5));
  if (!Number.isInteger(input.eligibleMonths) || input.eligibleMonths < 1 || input.eligibleMonths > month) {
    throw Error('TAX_ELIGIBLE_MONTHS_INVALID');
  }
  const income = money(input.cumulativeIncomeFen);
  const exempt = money(input.cumulativeExemptIncomeFen);
  const other = money(input.cumulativeOtherDeductionFen);
  const reduction = money(input.cumulativeTaxReductionFen);
  const withheld = money(input.cumulativeWithheldFen);
  if (exempt > income) throw Error('TAX_EXEMPT_INCOME_INVALID');
  const deduction = 500000n * BigInt(input.eligibleMonths);
  // Preserve fractional fen through the statutory 20% expense calculation.
  const taxableHundredths = income * 80n - (exempt + other + deduction) * 100n;
  const taxable = taxableHundredths > 0n ? taxableHundredths : 0n;
  const [, rate, quick] = BRACKETS.find(([limit]) => limit === null || taxable <= limit * 100n);
  const raw = taxable * rate - quick * 10000n;
  const grossTax = raw > 0n ? (raw + 5000n) / 10000n : 0n;
  const liability = grossTax > reduction ? grossTax - reduction : 0n;
  const due = liability > withheld ? liability - withheld : 0n;
  return {
    ruleVersion: VERSION, period: input.period, scope: 'PREVIEW_ONLY', payable: false,
    cumulativeIncomeFen: income.toString(), eligibleMonths: input.eligibleMonths,
    cumulativeDeductionFen: deduction.toString(), ratePercent: Number(rate),
    quickDeductionFen: quick.toString(), cumulativeTaxFen: liability.toString(),
    currentWithholdingFen: due.toString(),
    // Negative cumulative differences are not an automatic payout/refund.
    excessWithheldFen: (withheld > liability ? withheld - liability : 0n).toString(),
    roundingRule: 'HALF_UP_FINAL_FEN_PENDING_FILING_RECONCILIATION'
  };
}
function previewProviderTax(profile, input) {
  const treatment = providerTaxTreatment(profile);
  if (treatment.status !== 'CALCULATION_SUPPORTED') return treatment;
  return previewPlatformLaborTax({ ...input, incomeType: treatment.calculationType });
}
module.exports = { VERSION, previewPlatformLaborTax, previewProviderTax };
