// Explicit isolated local test database; no application credentials or production host.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const { readWithdrawalProgress } = require('../cloudfunctions/payment-api/withdrawal-progress-store');
const { reserveWithdrawalPayment } = require('../cloudfunctions/payment-api/withdrawal-payment-store');
const { recordWithdrawalReceipt } = require('../scripts/record-withdrawal-receipt');
const { findWithdrawalReceipt } = require('../scripts/find-withdrawal-receipt');
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (port !== 33317) throw Error('Explicit isolated test port 33317 required');
const database = 'anime_withdrawal_test_' + crypto.randomBytes(8).toString('hex');
const config = { appid: 'wx_test', platformMchid: 'test_merchant' };
let admin, pool;
before(async () => {
  admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password: '', database });
  const folder = path.join(__dirname, '../database/mysql');
  for (const file of fs.readdirSync(folder).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    const sql = fs.readFileSync(path.join(folder, file), 'utf8');
    for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').filter(s => s.trim())) await pool.query(statement);
  }
  await pool.query("INSERT INTO accounts(id,uid,nickname,created_at,updated_at) VALUES('buyer','buyer','TEST',1,1),('provider','provider','TEST',1,1)");
  await pool.query("INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES('buyer','test_openid',1,1)");
  await pool.query("INSERT INTO provider_qualifications(provider_id,career,status,application,eligibility_verified,reviewed_by,evidence_reference,submitted_at,reviewed_at) VALUES('provider','摄影','APPROVED','{}',1,'test','test',1,1)");
});
async function receiptFixture(){
  const requestId=await request('100'),paymentId=crypto.randomBytes(16).toString('hex');
  const input={requestId,paymentId,providerId:'provider',operatorId:'finance',accountVersionId:'b'.repeat(32),amountFen:'100'};
  await reserveWithdrawalPayment(pool,input,config);
  // Synthetic pre-exported state; does not claim a live export or source-backed withdrawal.
  await pool.execute("UPDATE withdrawal_bank_payments SET status='EXPORTED' WHERE id=?",[paymentId]);
  return {...input,eventId:crypto.randomBytes(16).toString('hex'),evidenceReference:'fixture-bank-proof',bankResultVerified:true};
}
test('bank unknown remains reserved; concurrent verified receipt retries count once and stale retry cannot revert success',async()=>{
  const input={...await receiptFixture(),status:'UNKNOWN'};
  await recordWithdrawalReceipt(pool,input,config);
  assert.equal((await readWithdrawalProgress(pool,input.requestId,'provider',config)).progress.unallocatedFen,'0');
  const success={...input,eventId:crypto.randomBytes(16).toString('hex'),status:'SUCCEEDED',bankTransactionReference:'bank-'+input.paymentId};
  const results=await Promise.all(Array.from({length:10},()=>recordWithdrawalReceipt(pool,success,config)));
  assert.ok(results.every(r=>r.status==='SUCCEEDED'));
  assert.equal((await recordWithdrawalReceipt(pool,input,config)).status,'SUCCEEDED');
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_receipt_events WHERE payment_id=?',[input.paymentId]);
  assert.equal(count.n,2);
  assert.equal((await readWithdrawalProgress(pool,input.requestId,'provider',config)).progress.paidFen,'100');
  await assert.rejects(recordWithdrawalReceipt(pool,{...success,eventId:crypto.randomBytes(16).toString('hex'),status:'FAILED',bankTransactionReference:null},config),/TRANSITION_INVALID/);
});

test('lost receipt response is recoverable without writes and old events report the current payment state',async()=>{
  const input={...await receiptFixture(),status:'UNKNOWN'};
  assert.deepEqual(await findWithdrawalReceipt(pool,input,config),{found:false,eventId:input.eventId});
  // Commit succeeds but its response is discarded, as with a broken client connection.
  await recordWithdrawalReceipt(pool,input,config);
  assert.deepEqual(await findWithdrawalReceipt(pool,input,config),{found:true,eventId:input.eventId,
    paymentId:input.paymentId,recordedStatus:'UNKNOWN',status:'UNKNOWN'});
  const success={...input,eventId:crypto.randomBytes(16).toString('hex'),status:'SUCCEEDED',bankTransactionReference:'recovery-'+input.paymentId};
  await recordWithdrawalReceipt(pool,success,config);
  const readOnly=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password:'',database});
  try{
    await readOnly.query('START TRANSACTION READ ONLY');
    assert.deepEqual(await findWithdrawalReceipt(readOnly,input,config),{found:true,eventId:input.eventId,
      paymentId:input.paymentId,recordedStatus:'UNKNOWN',status:'SUCCEEDED'});
    for(const change of [{requestId:'0'.repeat(32)},{paymentId:'0'.repeat(32)},{providerId:'foreign'}])
      assert.equal((await findWithdrawalReceipt(readOnly,{...input,...change},config)).found,false);
    for(const change of [{appid:'foreign'},{platformMchid:'foreign'}])
      assert.equal((await findWithdrawalReceipt(readOnly,input,{...config,...change})).found,false);
    await readOnly.commit();
  }finally{await readOnly.end();}
  const [[events]]=await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_receipt_events WHERE payment_id=?',[input.paymentId]);
  assert.equal(events.n,2);
  assert.equal((await readWithdrawalProgress(pool,input.requestId,'provider',config)).progress.paidFen,'100');
});
test('receipt refuses an already overallocated request without creating an event or changing payment',async()=>{
  const input={...await receiptFixture(),status:'SUCCEEDED',bankTransactionReference:'corrupt-request-fixture'};
  await payment(input.requestId,'1','UNKNOWN');
  await assert.rejects(recordWithdrawalReceipt(pool,input,config),/OVERALLOCATED/);
  const [[row]]=await pool.execute('SELECT status FROM withdrawal_bank_payments WHERE id=?',[input.paymentId]);
  assert.equal(row.status,'EXPORTED');
  const [[events]]=await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_receipt_events WHERE payment_id=?',[input.paymentId]);
  assert.equal(events.n,0);
});
test('bank evidence mismatch and reused bank transaction cannot release or duplicate payment',async()=>{
  const first={...await receiptFixture(),status:'SUCCEEDED',bankTransactionReference:'unique-bank-fixture'};
  for(const change of [{amountFen:'99'},{accountVersionId:'c'.repeat(32)},{providerId:'foreign'},{bankResultVerified:false}])
    await assert.rejects(recordWithdrawalReceipt(pool,{...first,...change},config),/MISMATCH|NOT_READY|INVALID/);
  await recordWithdrawalReceipt(pool,first,config);
  const second={...await receiptFixture(),status:'SUCCEEDED',bankTransactionReference:first.bankTransactionReference};
  await assert.rejects(recordWithdrawalReceipt(pool,second,config),/CONFLICT/);
  const [[row]]=await pool.execute('SELECT status FROM withdrawal_bank_payments WHERE id=?',[second.paymentId]);
  assert.equal(row.status,'EXPORTED');
  const failed={...second,status:'FAILED',bankTransactionReference:null};
  await recordWithdrawalReceipt(pool,failed,config);
  assert.equal((await readWithdrawalProgress(pool,second.requestId,'provider',config)).progress.unallocatedFen,'100');
  const [[retained]] = await pool.execute('SELECT CAST(amount_fen AS CHAR) AS amount FROM withdrawal_sources WHERE withdrawal_id=?', [second.requestId]);
  assert.equal(retained.amount, '100');
  await reserveWithdrawalPayment(pool, { ...second, paymentId: crypto.randomBytes(16).toString('hex') }, config);
  await assert.rejects(recordWithdrawalReceipt(pool,{...failed,evidenceReference:'changed'},config),/CONFLICT/);
});
after(async () => {
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
});
async function request(amount, approved = true) {
  const id = crypto.randomBytes(16).toString('hex');
  await pool.execute(`INSERT INTO withdrawal_requests
    (id,appid,platform_mchid,provider_id,requested_net_fen,approved_net_fen,approval_reference,approved_by,approved_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, config.appid, config.platformMchid, 'provider', amount,
    approved ? amount : null, approved ? 'approval' : null, approved ? 'finance' : null, approved ? 2 : null, 1]);
  // Payment-writer tests now use real collection/net/source writers; projection-only large requests do not allocate.
  if (approved && BigInt(amount) <= 7900n) await backRequest(id, amount);
  return id;
}
async function backRequest(requestId, amount) {
  const { reservePayment, recordPaymentSuccess } = require('../cloudfunctions/payment-api/payment-store');
  const { reserveBankBatch } = require('../cloudfunctions/payment-api/bank-settlement-store');
  const { readBankBatchReview } = require('../cloudfunctions/payment-api/bank-batch-review');
  const { snapshotHash } = require('../scripts/finance-tax-result-review');
  const { saveFinanceResult } = require('../scripts/finance-tax-result-store');
  const { approveFinanceResult } = require('../scripts/finance-result-approve-store');
  const { reserveWithdrawalSources } = require('../cloudfunctions/payment-api/withdrawal-source-store');
  const payload = { public: { amountFen: 10000, paymentStatus: 'UNPAID', buyerAgreementConfirmedAt: 1,
    communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true,
    executable: true, ndaRequired: false, provider: { career: '摄影' }, items: [{ serviceId: 'test', finalPriceFen: 10000 }] }, events: [] };
  await pool.execute(`INSERT INTO order_aggregates(id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at)
    VALUES(?,'buyer','provider',?,?,'BUYER_FINAL_CONFIRM',?,1,1)`, [requestId, requestId, '0'.repeat(64), JSON.stringify(payload)]);
  const p = await reservePayment(pool, { orderId: requestId, buyerId: 'buyer', requestKey: requestId, expectedVersion: 1,
    ...config, payerOpenid: 'test_openid', paymentMode: 'DIRECT', feeRuleVersion: 'PLATFORM_20_PERCENT_V1' }, 2);
  await recordPaymentSuccess(pool, { tradeState: 'SUCCESS', outTradeNo: p.id, combineOutTradeNo: p.id,
    ...config, subMchid: p.sub_mchid, payerOpenid: 'test_openid', payerVerification: 'MATCHED',
    transactionId: 'wx_' + p.id, totalFen: 10000, payerPaidFen: 10000, currency: 'CNY', paidAt: 3, paymentMode: 'DIRECT' }, 3);
  const [[order]] = await pool.execute('SELECT payload FROM order_aggregates WHERE id=?', [requestId]);
  const completed = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
  completed.public.completedAt = 4;
  completed.settlementIntent = { status: 'PENDING', paymentId: p.id, acceptedOrderVersion: 2, createdAt: 4 };
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED',payload=? WHERE id=?", [JSON.stringify(completed), requestId]);
  await pool.execute('INSERT INTO order_funds_interlocks(order_id) VALUES(?)', [requestId]);
  const batch = await reserveBankBatch(pool, { paymentIds: [p.id], operatorId: 'finance', requestKey: requestId }, config, 5);
  const review = await readBankBatchReview(pool, batch.batchId, config);
  const imported = await saveFinanceResult(pool, config, review, { resultId: requestId, batchId: batch.batchId,
    sourceSha256: snapshotHash(review), evidenceReference: 'synthetic-finance-proof', records: [{ paymentId: p.id,
      orderId: requestId, providerId: 'provider', taxPeriod: '2026-09', basisReference: 'fixture',
      providerPretaxFen: '8000', incomeTaxFen: '100', vatFen: '0', surchargeFen: '0', providerNetFen: '7900' }] }, 'finance');
  await approveFinanceResult(pool, imported.id, { ...config, operatorId: 'finance' }, 6);
  await reserveWithdrawalSources(pool, requestId, [{ paymentId: p.id, amountFen: amount }], { ...config, providerId: 'provider' });
}
async function payment(requestId, amount, status) {
  const paymentId=crypto.randomBytes(16).toString('hex');
  const result=await pool.execute(`INSERT INTO withdrawal_bank_payments
    (id,withdrawal_id,amount_fen,status,account_version_id,evidence_reference,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'finance',1,2)`, [paymentId, requestId, amount, status==='SUCCEEDED'?'EXPORTED':status, 'b'.repeat(32), 'test_evidence']);
  if(status==='SUCCEEDED')await recordWithdrawalReceipt(pool,{requestId,paymentId,eventId:crypto.randomBytes(16).toString('hex'),
    providerId:'provider',operatorId:'finance',accountVersionId:'b'.repeat(32),amountFen:amount,status,
    evidenceReference:'synthetic-proof',bankResultVerified:true,bankTransactionReference:'synthetic-'+paymentId},config);
  return result;
}

test('paid progress requires matching success evidence, not only a mutable payment status',async()=>{
  const input=await receiptFixture();
  await pool.execute("UPDATE withdrawal_bank_payments SET status='SUCCEEDED' WHERE id=?",[input.paymentId]);
  await assert.rejects(readWithdrawalProgress(pool,input.requestId,'provider',config),/RECEIPT_EVIDENCE_MISMATCH/);
  await pool.execute("UPDATE withdrawal_bank_payments SET status='EXPORTED' WHERE id=?",[input.paymentId]);
  await recordWithdrawalReceipt(pool,{...input,status:'SUCCEEDED',bankTransactionReference:'evidence-'+input.paymentId},config);
  assert.equal((await readWithdrawalProgress(pool,input.requestId,'provider',config)).progress.paidFen,'100');
  for(const [column,value,original] of [['amount_fen','99','100'],['account_version_id','c'.repeat(32),input.accountVersionId]]){
    await pool.execute(`UPDATE withdrawal_bank_payments SET ${column}=? WHERE id=?`,[value,input.paymentId]);
    await assert.rejects(readWithdrawalProgress(pool,input.requestId,'provider',config),/RECEIPT_EVIDENCE_MISMATCH/);
    await pool.execute(`UPDATE withdrawal_bank_payments SET ${column}=? WHERE id=?`,[original,input.paymentId]);
  }
  await pool.execute("UPDATE withdrawal_receipt_events SET evidence_reference='changed' WHERE id=?",[input.eventId]);
  await assert.rejects(readWithdrawalProgress(pool,input.requestId,'provider',config),/RECEIPT_EVIDENCE_MISMATCH/);
});

test('a failed status without verified evidence cannot release capacity for another bank payment',async()=>{
  const input=await receiptFixture();
  await pool.execute("UPDATE withdrawal_bank_payments SET status='FAILED' WHERE id=?",[input.paymentId]);
  await assert.rejects(reserveWithdrawalPayment(pool,{...input,paymentId:crypto.randomBytes(16).toString('hex')},config),/RECEIPT_EVIDENCE_MISMATCH/);
  await assert.rejects(readWithdrawalProgress(pool,input.requestId,'provider',config),/RECEIPT_EVIDENCE_MISMATCH/);
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?',[input.requestId]);
  assert.equal(count.n,1);
});

test('terminal evidence is checked by both writers, including retries and status reversals',async()=>{
  for(const status of ['SUCCEEDED','FAILED']){
    const input=await receiptFixture();
    const terminal={...input,status,bankTransactionReference:status==='SUCCEEDED'?'terminal-'+input.paymentId:null};
    await recordWithdrawalReceipt(pool,terminal,config);
    await pool.execute("UPDATE withdrawal_receipt_events SET evidence_reference='changed' WHERE id=?",[input.eventId]);
    await assert.rejects(reserveWithdrawalPayment(pool,input,config),/RECEIPT_EVIDENCE_MISMATCH/);
    await assert.rejects(recordWithdrawalReceipt(pool,terminal,config),/RECEIPT_EVIDENCE_MISMATCH/);
    await pool.execute('UPDATE withdrawal_receipt_events SET evidence_reference=? WHERE id=?',[input.evidenceReference,input.eventId]);
    await pool.execute("UPDATE withdrawal_bank_payments SET status='EXPORTED' WHERE id=?",[input.paymentId]);
    await assert.rejects(readWithdrawalProgress(pool,input.requestId,'provider',config),/RECEIPT_EVIDENCE_MISMATCH/);
    await assert.rejects(recordWithdrawalReceipt(pool,{...terminal,eventId:crypto.randomBytes(16).toString('hex')},config),/RECEIPT_EVIDENCE_MISMATCH/);
    const [[events]]=await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_receipt_events WHERE payment_id=?',[input.paymentId]);
    assert.equal(events.n,1);
  }
});
test('real MySQL retains partial bank payments and unknown money', async () => {
  const id = await request('10000');
  await payment(id, '3000', 'SUCCEEDED'); await payment(id, '2000', 'UNKNOWN');
  const result = await readWithdrawalProgress(pool, id, 'provider', config);
  assert.equal(result.progress.paidFen, '3000'); assert.equal(result.progress.remainingFen, '7000');
  assert.equal(result.progress.unallocatedFen, '5000'); assert.equal(result.progress.needsReview, true);
  assert.equal(result.status, 'PARTIALLY_PAID'); assert.equal(result.payable, false);
});
test('real provider, app and merchant isolation', async () => {
  const id = await request('100');
  for (const [provider, scope] of [['other', config], ['provider', { ...config, appid: 'foreign' }],
    ['provider', { ...config, platformMchid: 'foreign' }]]) {
    await assert.rejects(readWithdrawalProgress(pool, id, provider, scope), /NOT_FOUND/);
  }
});
test('database rejects approval deductions and incomplete approval fields', async () => {
  const id = await request('100', false);
  for (const sql of [
    'approved_net_fen=99,approval_reference=\'a\',approved_by=\'finance\',approved_at=2',
    'approved_net_fen=101,approval_reference=\'a\',approved_by=\'finance\',approved_at=2',
    'approved_net_fen=100,approval_reference=\'a\',approved_by=\'finance\',approved_at=NULL',
    'approval_reference=\'a\''
  ]) await assert.rejects(pool.execute(`UPDATE withdrawal_requests SET ${sql} WHERE id=?`, [id]), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
  const result = await readWithdrawalProgress(pool, id, 'provider', config);
  assert.equal(result.status, 'AWAITING_APPROVAL');
});
test('BIGINT read remains exact even without driver bigNumberStrings option', async () => {
  const id = await request('9007199254740993');
  await payment(id, '9007199254740992', 'SUCCEEDED');
  const result = await readWithdrawalProgress(pool, id, 'provider', config);
  assert.equal(result.progress.remainingFen, '1');
});
test('foreign-key and positive-payment constraints reject invalid rows', async () => {
  await assert.rejects(payment('f'.repeat(32), '1', 'SUCCEEDED'), e => e.code === 'ER_NO_REFERENCED_ROW_2');
  const id = await request('100');
  await assert.rejects(payment(id, '0', 'PROCESSING'), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
});
test('reader fails closed on aggregate overpayment not enforced by row constraints', async () => {
  const id = await request('100');
  await payment(id, '60', 'SUCCEEDED'); await payment(id, '41', 'PROCESSING');
  await assert.rejects(readWithdrawalProgress(pool, id, 'provider', config), /OVERALLOCATED/);
});

const reservation = (requestId, amountFen = '100') => ({ requestId, amountFen,
  paymentId: crypto.randomBytes(16).toString('hex'), providerId: 'provider', operatorId: 'finance', accountVersionId: 'b'.repeat(32) });
test('reservation retry refuses corrupted aggregate without changing existing allocation', async () => {
  const id = await request('100'), input = reservation(id);
  await reserveWithdrawalPayment(pool, input, config);
  await payment(id, '1', 'UNKNOWN');
  await assert.rejects(reserveWithdrawalPayment(pool, input, config), /OVERALLOCATED/);
  const [[row]] = await pool.execute('SELECT status FROM withdrawal_bank_payments WHERE id=?', [input.paymentId]);
  assert.equal(row.status, 'RESERVED');
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [id]);
  assert.equal(count.n, 2);
});
test('twenty concurrent identical requests create one reservation', async () => {
  const id = await request('100'), input = reservation(id);
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveWithdrawalPayment(pool, input, config)));
  assert.ok(results.every(r => r.paymentId === input.paymentId && r.status === 'RESERVED' && r.payable === false));
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [id]);
  assert.equal(count.n, 1);
});
test('competing allocations serialize and cannot reserve above approved net', async () => {
  const id = await request('100');
  const results = await Promise.allSettled([reserveWithdrawalPayment(pool, reservation(id, '70'), config),
    reserveWithdrawalPayment(pool, reservation(id, '70'), config)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /AMOUNT_UNAVAILABLE/);
  assert.equal((await readWithdrawalProgress(pool, id, 'provider', config)).progress.unallocatedFen, '30');
});
test('same identifier cannot change money or account and never revives cancelled payment', async () => {
  const id = await request('100'), input = reservation(id, '50');
  await reserveWithdrawalPayment(pool, input, config);
  for (const change of [{ amountFen: '51' }, { accountVersionId: 'c'.repeat(32) }, { operatorId: 'other' }]) {
    await assert.rejects(reserveWithdrawalPayment(pool, { ...input, ...change }, config), /IDEMPOTENCY_MISMATCH/);
  }
  await pool.execute("UPDATE withdrawal_bank_payments SET status='CANCELLED' WHERE id=?", [input.paymentId]);
  assert.equal((await reserveWithdrawalPayment(pool, input, config)).status, 'CANCELLED');
});
test('unapproved and foreign-scoped requests cannot create reservations', async () => {
  const id = await request('100', false), input = reservation(id);
  await assert.rejects(reserveWithdrawalPayment(pool, input, config), /NOT_APPROVED/);
  await assert.rejects(reserveWithdrawalPayment(pool, { ...input, providerId: 'other' }, config), /NOT_FOUND/);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [id]);
  assert.equal(count.n, 0);
});

test('approved money without a source or with a partial source total cannot create a bank reservation', async () => {
  const missing = await request('10000');
  await assert.rejects(reserveWithdrawalPayment(pool, reservation(missing), config), /SOURCE_MISSING/);
  const partial = await request('100');
  await pool.execute('UPDATE withdrawal_sources SET amount_fen=99 WHERE withdrawal_id=?', [partial]);
  await assert.rejects(reserveWithdrawalPayment(pool, reservation(partial), config), /SOURCE_TOTAL_MISMATCH/);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id IN (?,?)', [missing, partial]);
  assert.equal(count.n, 0);
});

test('source held after reservation blocks retry and a second bank payment without releasing income', async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  const requestId = await request('100'), input = reservation(requestId, '50');
  await reserveWithdrawalPayment(pool, input, config);
  await holdOrderFunds(pool, requestId, 'DISPUTE', Date.now());
  for (const next of [input, reservation(requestId, '50')]) {
    await assert.rejects(reserveWithdrawalPayment(pool, next, config), /SOURCE_NOT_READY/);
  }
  const [[parts]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
  const [[source]] = await pool.execute('SELECT CAST(amount_fen AS CHAR) AS amount FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  assert.equal(parts.n, 1); assert.equal(source.amount, '100');
});

test('refund after net approval blocks withdrawal even if its hold is mistakenly cleared', async () => {
  const { requestRefund, reviewRefund } = require('../cloudfunctions/payment-api/refund-store');
  const { claimRefund } = require('../cloudfunctions/payment-api/refund-execution');
  const { recordRefundResult } = require('../cloudfunctions/payment-api/refund-results');
  const requestId = await request('100'), input = reservation(requestId, '50');
  await reserveWithdrawalPayment(pool, input, config);
  const [[source]] = await pool.execute('SELECT payment_id FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  const refundInput = { orderId: requestId, paymentId: source.payment_id, buyerId: 'buyer',
    requestKey: crypto.randomBytes(16).toString('hex'), amountFen: 3000, reason: 'synthetic historical refund' };
  await assert.rejects(requestRefund(pool, refundInput, config.platformMchid, 10), /REFUND_ORDER_COMPLETED/);
  // Historical in-flight refund fixture only; no new post-acceptance refund route is enabled.
  await pool.execute("UPDATE order_aggregates SET stage='IN_PRODUCTION' WHERE id=?", [requestId]);
  const refund = await requestRefund(pool, refundInput, config.platformMchid, 10);
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED' WHERE id=?", [requestId]);
  await reviewRefund(pool, { refundId: refund.id, reviewerId: 'finance', decision: 'APPROVE', evidenceReference: 'synthetic' }, 11);
  await claimRefund(pool, refund.id, { ...config, refundEnabled: true }, 12);
  await recordRefundResult(pool, { refundId: refund.id, channelRefundId: 'fixture_' + refund.id,
    status: 'SUCCESS', amountFen: 3000, succeededAt: 13 }, 13);
  for (const next of [input, reservation(requestId, '50')]) {
    await assert.rejects(reserveWithdrawalPayment(pool, next, config), /SOURCE_NOT_READY/);
  }
  await pool.execute('UPDATE order_funds_interlocks SET hold_reason=NULL,held_at=NULL WHERE order_id=?', [requestId]);
  for (const next of [input, reservation(requestId, '50')]) {
    await assert.rejects(reserveWithdrawalPayment(pool, next, config), /SOURCE_LEDGER_MISMATCH/);
  }
  const [[parts]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
  const [[retained]] = await pool.execute('SELECT CAST(amount_fen AS CHAR) AS amount FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  assert.equal(parts.n, 1);
  assert.equal(retained.amount, '100');
});

test('withdrawal waits for an earlier uncommitted dispute then refuses stale data', { timeout: 10000 }, async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  const requestId = await request('100');
  let held, release, attempted;
  const ready = new Promise(resolve => held = resolve), gate = new Promise(resolve => release = resolve);
  const attempting = new Promise(resolve => attempted = resolve);
  function wrapped(mode) { return { execute: pool.execute.bind(pool), async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, key) {
      if (mode === 'hold' && key === 'commit') return async () => { held(); await gate; return target.commit(); };
      if (mode === 'withdraw' && key === 'execute') return async (sql, args) => {
        if (sql.includes('FROM order_aggregates') && sql.includes('FOR UPDATE')) attempted();
        return target.execute(sql, args);
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  } }; }
  const hold = holdOrderFunds(wrapped('hold'), requestId, 'DISPUTE', Date.now());
  let withdrawal;
  try {
    await ready;
    withdrawal = assert.rejects(reserveWithdrawalPayment(wrapped('withdraw'), reservation(requestId), config), /SOURCE_NOT_READY/);
    await attempting; release(); await hold; await withdrawal;
    const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
    assert.equal(count.n, 0);
  } finally { release(); await hold; if (withdrawal) await withdrawal; }
});

test('unbalanced backing, wrong owner and corrupt ledger all refuse bank allocation', async () => {
  for (const kind of ['capacity', 'owner', 'ledger']) {
    const requestId = await request('100');
    const [[source]] = await pool.execute('SELECT payment_id FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
    if (kind === 'capacity') {
      await pool.execute('UPDATE finance_net_settlements SET provider_net_fen=99,income_tax_fen=7901 WHERE payment_id=?', [source.payment_id]);
    } else if (kind === 'owner') {
      await pool.execute("UPDATE finance_net_settlements SET provider_id='foreign' WHERE payment_id=?", [source.payment_id]);
    } else {
      await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen-1 WHERE journal_id=? AND account='PROVIDER_NET'", ['net:' + source.payment_id]);
    }
    await assert.rejects(reserveWithdrawalPayment(pool, reservation(requestId), config),
      kind === 'capacity' ? /SOURCE_UNAVAILABLE/ : kind === 'owner' ? /SOURCE_NOT_FOUND/ : /SOURCE_LEDGER_MISMATCH/);
    const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
    assert.equal(count.n, 0);
  }
});

test('one refund-held order in a multi-source withdrawal prevents the entire bank reservation', async () => {
  const { reserveWithdrawalSources } = require('../cloudfunctions/payment-api/withdrawal-source-store');
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  const requests = [await request('100'), await request('100')], combined = await request('10000');
  const [sources] = await pool.execute('SELECT payment_id FROM withdrawal_sources WHERE withdrawal_id IN (?,?)', requests);
  await reserveWithdrawalSources(pool, combined, sources.map(s => ({ paymentId: s.payment_id, amountFen: '5000' })),
    { ...config, providerId: 'provider' });
  await holdOrderFunds(pool, requests[1], 'REFUND_REQUEST', Date.now());
  await assert.rejects(reserveWithdrawalPayment(pool, reservation(combined, '10000'), config), /SOURCE_NOT_READY/);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [combined]);
  assert.equal(count.n, 0);
});

test('matching net and ledger edits cannot override approved financial evidence', async () => {
  const requestId = await request('100');
  const [[source]] = await pool.execute('SELECT payment_id FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  await pool.execute('UPDATE finance_net_settlements SET provider_net_fen=7901,income_tax_fen=99 WHERE payment_id=?', [source.payment_id]);
  await pool.execute("UPDATE fund_postings SET amount_fen=7901 WHERE journal_id=? AND account='PROVIDER_NET'", ['net:' + source.payment_id]);
  await pool.execute("UPDATE fund_postings SET amount_fen=99 WHERE journal_id=? AND account='INCOME_TAX_PAYABLE'", ['net:' + source.payment_id]);
  await assert.rejects(reserveWithdrawalPayment(pool, reservation(requestId), config), /SOURCE_LEDGER_MISMATCH/);
  // Editing the matching evidence too still cannot pass its original stored fingerprint.
  await pool.execute(`UPDATE finance_result_imports i JOIN finance_net_settlements n ON n.import_id=i.id
    SET i.result_snapshot=JSON_SET(i.result_snapshot,'$.records[0].providerNetFen','7901',
      '$.records[0].incomeTaxFen','99','$.records[0].withholdingFen','99') WHERE n.payment_id=?`, [source.payment_id]);
  await assert.rejects(reserveWithdrawalPayment(pool, reservation(requestId), config), /SOURCE_LEDGER_MISMATCH/);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
  assert.equal(count.n, 0);
});

test('restricted reservation account can lock and allocate without changing approvals or ledger', async () => {
  const { reserveWithdrawalSources } = require('../cloudfunctions/payment-api/withdrawal-source-store');
  const requestId = await request('100');
  const [[source]] = await pool.execute('SELECT payment_id FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  // Restore the unallocated state only in this isolated fixture, before the restricted account acts.
  await pool.execute('DELETE FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  const user = 'withdraw_' + crypto.randomBytes(6).toString('hex'), password = crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    const readable = ['withdrawal_requests', 'withdrawal_bank_payments', 'withdrawal_sources', 'finance_net_settlements',
      'order_payments', 'order_aggregates', 'order_refunds', 'order_funds_interlocks', 'order_refund_reversals',
      'fund_journals', 'fund_postings', 'finance_result_imports', 'withdrawal_receipt_events'];
    for (const table of readable) await admin.query(`GRANT SELECT ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    for (const table of ['withdrawal_sources', 'withdrawal_bank_payments']) {
      await admin.query(`GRANT INSERT ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    restricted = mysql.createPool({ host: '127.0.0.1', port, user, password, database });
    const allocation = [{ paymentId: source.payment_id, amountFen: '100' }];
    await assert.rejects(reserveWithdrawalSources(restricted, requestId, allocation,
      { ...config, providerId: 'provider' }), error => error.code === 'ER_TABLEACCESS_DENIED_ERROR');
    // MySQL requires an additional locking privilege. Limit UPDATE to identifier columns, not money or state.
    for (const table of ['withdrawal_requests', 'withdrawal_bank_payments', 'order_payments', 'order_aggregates']) {
      await admin.query(`GRANT UPDATE(id) ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    for (const table of ['finance_net_settlements', 'withdrawal_sources']) {
      await admin.query(`GRANT UPDATE(payment_id) ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    await reserveWithdrawalSources(restricted, requestId, allocation, { ...config, providerId: 'provider' });
    const input = reservation(requestId);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveWithdrawalPayment(restricted, input, config)));
    assert.ok(results.every(r => r.paymentId === input.paymentId && r.payable === false));
    assert.equal((await reserveWithdrawalSources(restricted, requestId, allocation,
      { ...config, providerId: 'provider' })).alreadyReserved, true);
    const denied = error => ['ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR'].includes(error.code);
    for (const sql of [
      'UPDATE withdrawal_requests SET approved_net_fen=approved_net_fen WHERE 1=0',
      'UPDATE finance_net_settlements SET provider_net_fen=provider_net_fen WHERE 1=0',
      'UPDATE finance_result_imports SET result_sha256=result_sha256 WHERE 1=0',
      'UPDATE fund_postings SET amount_fen=amount_fen WHERE 1=0',
      'UPDATE withdrawal_bank_payments SET status=status WHERE 1=0',
      'UPDATE withdrawal_receipt_events SET input_sha256=input_sha256 WHERE 1=0',
      'DELETE FROM withdrawal_receipt_events WHERE 1=0',
      'DELETE FROM withdrawal_sources WHERE 1=0', 'DELETE FROM withdrawal_bank_payments WHERE 1=0',
      'SELECT id FROM accounts LIMIT 0'
    ]) await assert.rejects(restricted.query(sql), denied);
    const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_bank_payments WHERE withdrawal_id=?', [requestId]);
    assert.equal(count.n, 1);
  } finally {
    if (restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});
