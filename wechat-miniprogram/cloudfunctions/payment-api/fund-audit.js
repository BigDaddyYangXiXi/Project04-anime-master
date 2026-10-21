// Internal operator audit. A consistent read snapshot avoids false mismatches during a refund commit.
// Never repairs balances, changes status, or calls a payment channel.
const { refundAllocation } = require('./fee-policy');
const { financeNetEntries } = require('./fund-ledger');
const { financeResultFingerprint } = require('./finance-result-fingerprint');
async function auditPaymentFunds(pool, paymentId, scope) {
  if (typeof paymentId !== 'string' || !/^[a-f0-9]{32}$/.test(paymentId)) throw Error('FUND_AUDIT_INPUT_INVALID');
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    const [[payment]] = await connection.execute(`SELECT p.*,o.provider_id FROM order_payments p JOIN order_aggregates o ON o.id=p.order_id WHERE p.id=?${scope ? " AND p.appid=? AND p.platform_mchid=? AND p.payment_mode='DIRECT'" : ''}`,
      scope ? [paymentId,scope.appid,scope.platformMchid] : [paymentId]);
    if (!payment) throw Error('PAYMENT_NOT_FOUND');
    const report = await auditFundsInSnapshot(connection, payment);
    await connection.commit();
    return report;
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
async function auditOperatorPayment(pool,paymentId,config) {
  if(typeof config?.appid!=='string'||!config.appid||typeof config.platformMchid!=='string'||!config.platformMchid) throw Error('FUND_AUDIT_SCOPE_REQUIRED');
  return auditPaymentFunds(pool,paymentId,{appid:config.appid,platformMchid:config.platformMchid});
}
// Internal: the caller owns the transaction and supplies a merchant-scoped payment row.
async function auditFundsInSnapshot(connection, payment) {
  const paymentId = payment.id;
  const [refunds] = await connection.execute('SELECT * FROM order_refunds WHERE payment_id=?', [paymentId]);
  const [reversals] = await connection.execute('SELECT * FROM order_refund_reversals WHERE payment_id=?', [paymentId]);
  const [journals] = await connection.execute('SELECT * FROM fund_journals WHERE payment_id=?', [paymentId]);
  const [postings] = await connection.execute('SELECT f.* FROM fund_postings f JOIN fund_journals j ON j.id=f.journal_id WHERE j.payment_id=?', [paymentId]);
  const [netSources] = await connection.execute(`SELECT n.*,i.appid AS import_appid,i.platform_mchid AS import_mchid,
    i.source_sha256 AS import_source_sha256,i.result_id AS import_result_id,i.batch_id AS import_batch_id,
    i.created_by AS import_operator_id,i.result_sha256 AS import_result_sha256,i.result_snapshot AS import_snapshot FROM finance_net_settlements n
    JOIN finance_result_imports i ON i.id=n.import_id WHERE n.payment_id=?`,[paymentId]);
  const issues = [];
  const add = (code, id = paymentId) => issues.push({ code, id });
  for(const source of netSources)if(!journals.some(j=>j.id===source.journal_id&&j.event_type==='FINANCE_NET_APPROVED'))add('NET_JOURNAL_MISSING',source.journal_id);
  if (payment.payment_mode !== 'DIRECT') add('UNSUPPORTED_PAYMENT_MODE');
  if (payment.status === 'PAID_REQUIRES_REVIEW') add('PAYMENT_REVIEW_REQUIRED');
  const sum = (rows, field) => rows.reduce((value,row) => value + BigInt(row[field]), 0n);
  const successful = refunds.filter(row => row.status === 'SUCCESS');
  if (sum(successful,'amount_fen') !== BigInt(payment.refunded_fen)
    || sum(reversals,'refund_fen') !== BigInt(payment.refunded_fen)
    || sum(reversals,'platform_reversal_fen') !== BigInt(payment.platform_refunded_fen)
    || sum(reversals,'provider_reversal_fen') !== BigInt(payment.provider_refunded_fen)) add('REFUND_TOTALS_MISMATCH');
  for (const refund of successful) {
    const reversal = reversals.find(row => row.refund_id === refund.id);
    if (!reversal || BigInt(reversal.refund_fen) !== BigInt(refund.amount_fen)) add('REFUND_REVERSAL_MISSING_OR_MISMATCH',refund.id);
    if (!journals.some(row => row.id === `refund:${refund.id}` && row.refund_id === refund.id)) add('REFUND_JOURNAL_MISSING',refund.id);
  }
  for (const reversal of reversals) if (!successful.some(row => row.id === reversal.refund_id)) add('REVERSAL_WITHOUT_SUCCESS',reversal.refund_id);
  let cumulative = 0;
  for (const reversal of [...reversals].sort((a,b) => Number(a.cumulative_refund_fen)-Number(b.cumulative_refund_fen))) {
    try {
      const expected = refundAllocation({ totalFen:Number(payment.amount_fen), platformFeeFen:Number(payment.platform_fee_fen),
        feeRuleVersion:payment.fee_rule_version, previouslyRefundedFen:cumulative, refundFen:Number(reversal.refund_fen) });
      if (Number(reversal.cumulative_refund_fen) !== expected.cumulativeRefundFen
        || Number(reversal.platform_reversal_fen) !== expected.platformReversalFen
        || Number(reversal.provider_reversal_fen) !== expected.providerReversalFen) add('REFUND_ALLOCATION_MISMATCH',reversal.refund_id);
      cumulative = expected.cumulativeRefundFen;
    } catch { add('REFUND_ALLOCATION_MISMATCH',reversal.refund_id); }
  }
  if (payment.payment_mode === 'DIRECT' && payment.status === 'PAID'
    && !journals.some(row => row.id === `payment:${payment.id}` && row.event_type === 'PAYMENT_CONFIRMED')) add('PAYMENT_JOURNAL_MISSING');
  if (payment.payment_mode === 'DIRECT' && payment.status === 'PAID_REQUIRES_REVIEW'
    && !journals.some(row=>row.id===`review:${payment.id}`&&row.event_type==='PAYMENT_REVIEW_RECEIVED')) add('REVIEW_JOURNAL_MISSING');
  for (const journal of journals) {
    if(!['PAYMENT_CONFIRMED','REFUND_SUCCEEDED','PAYMENT_REVIEW_RECEIVED','FINANCE_NET_APPROVED'].includes(journal.event_type)) {
      add('JOURNAL_EVENT_UNSUPPORTED',journal.id);continue;
    }
    const entries = postings.filter(row => row.journal_id === journal.id);
    const debit = sum(entries.filter(row => row.direction === 'DEBIT'),'amount_fen');
    const credit = sum(entries.filter(row => row.direction === 'CREDIT'),'amount_fen');
    if (!entries.length || debit !== credit) add('JOURNAL_UNBALANCED',journal.id);
    const review=journal.event_type==='PAYMENT_REVIEW_RECEIVED';
    if (journal.provider_id !== payment.provider_id || journal.currency !== (review?payment.received_currency:payment.currency) || journal.fee_rule_version !== payment.fee_rule_version) add('JOURNAL_BINDING_MISMATCH',journal.id);
    if(journal.event_type==='FINANCE_NET_APPROVED'){
      const source=netSources.find(row=>row.journal_id===journal.id);
      if(!source){add('NET_SOURCE_MISSING',journal.id);continue;}
      if(journal.id!==`net:${payment.id}`||journal.refund_id||journal.reverses_journal_id
        ||source.provider_id!==payment.provider_id||source.import_appid!==payment.appid
        ||source.import_mchid!==payment.platform_mchid||source.source_sha256!==source.import_source_sha256
        ||String(source.approved_at)!==String(journal.created_at))add('NET_SOURCE_BINDING_MISMATCH',journal.id);
      try {
        const evidence=typeof source.import_snapshot==='string'?JSON.parse(source.import_snapshot):source.import_snapshot;
        if(financeResultFingerprint(evidence)!==source.import_result_sha256
          ||evidence.resultId!==source.import_result_id||evidence.batchId!==source.import_batch_id
          ||evidence.operatorId!==source.import_operator_id||evidence.sourceSha256!==source.import_source_sha256
          ||evidence.status!=='VALIDATED_DRAFT'||evidence.payable!==false)throw Error();
        const approved=evidence.records.filter(row=>row.paymentId===payment.id);
        if(approved.length!==1||approved[0].orderId!==payment.order_id||approved[0].providerId!==payment.provider_id
          ||[['providerPretaxFen','provider_pretax_fen'],['incomeTaxFen','income_tax_fen'],['vatFen','vat_fen'],
            ['surchargeFen','surcharge_fen'],['providerNetFen','provider_net_fen']].some(([field,column])=>
            approved[0][field]!==String(source[column])))throw Error();
      } catch { add('NET_APPROVED_EVIDENCE_MISMATCH',journal.id); }
      try{
        const expected=financeNetEntries(payment,{paymentId:source.payment_id,orderId:payment.order_id,providerId:source.provider_id,
          providerPretaxFen:source.provider_pretax_fen,incomeTaxFen:source.income_tax_fen,vatFen:source.vat_fen,
          surchargeFen:source.surcharge_fen,providerNetFen:source.provider_net_fen});
        if(entries.length!==expected.length||expected.some(want=>{
          const actual=entries.find(row=>row.account===want.account);
          return !actual||actual.direction!==want.direction||BigInt(actual.amount_fen)!==BigInt(want.amountFen);
        }))add('NET_POSTING_MISMATCH',journal.id);
      }catch{add('NET_SOURCE_AMOUNT_MISMATCH',journal.id);}
      continue;
    }
    if(review) {
      if(payment.status!=='PAID_REQUIRES_REVIEW'||journal.id!==`review:${payment.id}`||journal.refund_id||journal.reverses_journal_id) add('REVIEW_JOURNAL_BINDING_MISMATCH',journal.id);
      if(entries.length!==2)add('REVIEW_POSTING_MISMATCH',journal.id);
      for(const [account,direction] of [['CHANNEL_RECEIVABLE','DEBIT'],['REVIEW_SUSPENSE','CREDIT']]) {
        const entry=entries.find(row=>row.account===account);
        if(!entry||entry.direction!==direction||BigInt(entry.amount_fen)!==BigInt(payment.received_total_fen))add('REVIEW_POSTING_MISMATCH',journal.id);
      }
      continue;
    }
    const refund = journal.event_type === 'REFUND_SUCCEEDED';
    if(!refund&&(journal.id!==`payment:${payment.id}`||journal.refund_id||journal.reverses_journal_id))add('PAYMENT_JOURNAL_BINDING_MISMATCH',journal.id);
    if(refund&&journal.id!==`refund:${journal.refund_id}`)add('REFUND_JOURNAL_BINDING_MISMATCH',journal.id);
    const reversal = refund ? reversals.find(row => row.refund_id === journal.refund_id) : null;
    if (refund && (!reversal || journal.reverses_journal_id !== `payment:${payment.id}`)) { add('JOURNAL_SOURCE_MISMATCH',journal.id); continue; }
    const amount = BigInt(refund ? reversal.refund_fen : payment.amount_fen);
    const platform = BigInt(refund ? reversal.platform_reversal_fen : payment.platform_fee_fen);
    if(entries.length!==[amount,platform,amount-platform].filter(value=>value>0n).length)add('POSTING_COUNT_MISMATCH',journal.id);
    for (const [account, expected, direction] of [
      ['CHANNEL_RECEIVABLE',amount,refund?'CREDIT':'DEBIT'],
      ['PLATFORM_PENDING',platform,refund?'DEBIT':'CREDIT'],
      ['PROVIDER_PENDING',amount-platform,refund?'DEBIT':'CREDIT']
    ]) {
      const entry = entries.find(row => row.account === account);
      if (expected === 0n ? !!entry : !entry || entry.direction !== direction || BigInt(entry.amount_fen) !== expected) add('POSTING_AMOUNT_MISMATCH',journal.id);
    }
  }
  return { ok: issues.length === 0, paymentId, issues, scope: 'Local business records only; channel bills and bank arrival require separate reconciliation.' };
}
module.exports = { auditPaymentFunds, auditOperatorPayment, auditFundsInSnapshot };
