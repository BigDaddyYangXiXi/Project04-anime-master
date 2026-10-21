const { VERSION, platformFee } = require('./fee-policy');
function fail() { const error = new Error('FUND_LEDGER_MISMATCH'); error.code = error.message; throw error; }

// Caller holds order/payment locks and commits this together with its verified channel state.
// Append-only business receivables; never creates available or withdrawable funds.
async function postFunds(connection, payment, providerId, refund, allocation, now) {
  if (payment.payment_mode !== 'DIRECT') return;
  const total = Number(payment.amount_fen), fee = Number(payment.platform_fee_fen);
  if (payment.currency !== 'CNY' || payment.fee_rule_version !== VERSION || platformFee(total).amountFen !== fee
    || typeof providerId !== 'string' || !providerId) fail();
  const original = `payment:${payment.id}`;
  const id = refund ? `refund:${refund.id}` : original;
  const amount = refund ? Number(refund.amount_fen) : total;
  const platform = refund ? allocation.platformReversalFen : fee;
  const provider = refund ? allocation.providerReversalFen : total - fee;
  if (![amount, platform, provider].every(Number.isSafeInteger) || amount <= 0 || platform < 0 || provider < 0
    || BigInt(platform) + BigInt(provider) !== BigInt(amount)) fail();
  if (refund) {
    const [[source]] = await connection.execute('SELECT provider_id,payment_id FROM fund_journals WHERE id=?', [original]);
    if (!source || source.provider_id !== providerId || source.payment_id !== payment.id) fail();
  }
  await connection.execute(`INSERT INTO fund_journals
    (id,event_type,payment_id,refund_id,reverses_journal_id,provider_id,currency,fee_rule_version,created_at)
    VALUES(?,?,?,?,?,?,'CNY',?,?)`,
  [id, refund ? 'REFUND_SUCCEEDED' : 'PAYMENT_CONFIRMED', payment.id, refund?.id || null, refund ? original : null, providerId, VERSION, now]);
  for (const [account, value, direction] of [
    ['CHANNEL_RECEIVABLE', amount, refund ? 'CREDIT' : 'DEBIT'],
    ['PLATFORM_PENDING', platform, refund ? 'DEBIT' : 'CREDIT'],
    ['PROVIDER_PENDING', provider, refund ? 'DEBIT' : 'CREDIT']
  ]) {
    if (value > 0) await connection.execute('INSERT INTO fund_postings(journal_id,account,direction,amount_fen) VALUES(?,?,?,?)', [id, account, direction, value]);
  }
}
async function postReviewFunds(connection,payment,providerId,receipt,now) {
  if(payment.payment_mode!=='DIRECT')return;
  if(!Number.isSafeInteger(receipt.totalFen)||receipt.totalFen<=0||!/^[A-Z]{3}$/.test(receipt.currency)
    ||typeof providerId!=='string'||!providerId)fail();
  const id=`review:${payment.id}`;
  await connection.execute(`INSERT INTO fund_journals
    (id,event_type,payment_id,refund_id,reverses_journal_id,provider_id,currency,fee_rule_version,created_at)
    VALUES(?,'PAYMENT_REVIEW_RECEIVED',?,NULL,NULL,?,?,?,?)`,
  [id,payment.id,providerId,receipt.currency,payment.fee_rule_version,now]);
  for(const [account,direction] of [['CHANNEL_RECEIVABLE','DEBIT'],['REVIEW_SUSPENSE','CREDIT']]) {
    await connection.execute('INSERT INTO fund_postings(journal_id,account,direction,amount_fen) VALUES(?,?,?,?)',
      [id,account,direction,receipt.totalFen]);
  }
}
// Internal rule only; caller must verify persisted evidence, locks and eligibility before writing.
function financeNetEntries(payment,result){
  const fen=value=>{
    if(!['string','number'].includes(typeof value)||!/^(0|[1-9][0-9]*)$/.test(String(value))
      ||!Number.isSafeInteger(Number(value)))fail();
    return BigInt(value);
  };
  if(!payment||!result||payment.payment_mode!=='DIRECT'||payment.status!=='PAID'||payment.currency!=='CNY'
    ||payment.fee_rule_version!==VERSION||typeof payment.id!=='string'||!payment.id
    ||typeof payment.order_id!=='string'||!payment.order_id||typeof payment.provider_id!=='string'||!payment.provider_id
    ||result.paymentId!==payment.id||result.orderId!==payment.order_id||result.providerId!==payment.provider_id)fail();
  const total=fen(payment.amount_fen),fee=fen(payment.platform_fee_fen),refunded=fen(payment.refunded_fen);
  const platformRefunded=fen(payment.platform_refunded_fen),providerRefunded=fen(payment.provider_refunded_fen);
  if(total<=0n||refunded>total||platformRefunded>fee||platformRefunded+providerRefunded!==refunded
    ||BigInt(platformFee(Number(total)).amountFen)!==fee)fail();
  const retained=total-refunded;
  const retainedFee=retained===0n?0n:BigInt(platformFee(Number(retained)).amountFen);
  const pretax=fen(result.providerPretaxFen),incomeTax=fen(result.incomeTaxFen),vat=fen(result.vatFen);
  const surcharge=fen(result.surchargeFen),net=fen(result.providerNetFen);
  if(fee-platformRefunded!==retainedFee||pretax!==retained-retainedFee||pretax<=0n
    ||incomeTax+vat+surcharge+net!==pretax)fail();
  return [
    ['PROVIDER_PENDING','DEBIT',pretax],
    ['INCOME_TAX_PAYABLE','CREDIT',incomeTax],
    ['VAT_PAYABLE','CREDIT',vat],
    ['SURCHARGE_PAYABLE','CREDIT',surcharge],
    ['PROVIDER_NET','CREDIT',net]
  ].filter(([, ,amount])=>amount>0n).map(([account,direction,amount])=>({account,direction,amountFen:amount.toString()}));
}
// Internal only, no public action. Caller owns locks, evidence verification, approval and transaction.
// Any failure requires rolling back the entire caller transaction, including partial inserts here.
async function postFinanceNet(connection,payment,importId,sourceSha256,result,operatorId,now){
  if(!/^[a-f0-9]{32}$/.test(importId)||!/^[a-f0-9]{64}$/.test(sourceSha256)
    ||typeof operatorId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(operatorId)
    ||!Number.isSafeInteger(now)||now<=0)fail();
  const entries=financeNetEntries(payment,result),id=`net:${payment.id}`;
  await connection.execute(`INSERT INTO fund_journals
    (id,event_type,payment_id,refund_id,reverses_journal_id,provider_id,currency,fee_rule_version,created_at)
    VALUES(?,'FINANCE_NET_APPROVED',?,NULL,NULL,?,'CNY',?,?)`,
    [id,payment.id,payment.provider_id,payment.fee_rule_version,now]);
  for(const entry of entries)await connection.execute(
    'INSERT INTO fund_postings(journal_id,account,direction,amount_fen) VALUES(?,?,?,?)',
    [id,entry.account,entry.direction,entry.amountFen]);
  await connection.execute(`INSERT INTO finance_net_settlements
    (payment_id,import_id,journal_id,provider_id,source_sha256,provider_pretax_fen,income_tax_fen,vat_fen,surcharge_fen,provider_net_fen,approved_by,approved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[payment.id,importId,id,payment.provider_id,sourceSha256,result.providerPretaxFen,
    result.incomeTaxFen,result.vatFen,result.surchargeFen,result.providerNetFen,operatorId,now]);
  return {journalId:id};
}
module.exports = { postFunds,postReviewFunds,financeNetEntries,postFinanceNet };
