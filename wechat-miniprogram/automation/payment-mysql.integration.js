// Explicit local MySQL test; never connects to a configured application database.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const mysql = require("../cloudfunctions/payment-api/node_modules/mysql2/promise");
const { reservePayment, recordPaymentSuccess, recordPaymentClosed } = require("../cloudfunctions/payment-api/payment-store");
const { acceptPaymentNotification, acceptPaymentQuery } = require("../cloudfunctions/payment-api/payment-notifications");
const { handlePaymentHttp } = require("../cloudfunctions/payment-api/payment-http");
const { createNotificationFixture } = require("../cloudfunctions/payment-api/test-notification-fixture");
const { queryPayment } = require("../cloudfunctions/payment-api/wechat-query");
const { createQueryFixture } = require("../cloudfunctions/payment-api/test-query-fixture");
const notificationFixture = createNotificationFixture();
const queryFixture = createQueryFixture(notificationFixture.config);
const { handleOrder, encryptContact } = require("../cloudfunctions/order-api/order-core");
const { confirmWithSlots } = require("../cloudfunctions/order-api/slot-store");
const { prepareSettlement, claimSettlement, releaseSettlement, recordSettlementResult, LEASE_MS: SETTLEMENT_LEASE_MS } = require("../cloudfunctions/payment-api/settlement-store");
const { querySettlement } = require('../cloudfunctions/payment-api/settlement-query');
const { reviewQualification } = require("../scripts/qualification-review-core");
const { toClientOrder } = require("../miniprogram/services/cloud-orders");
const contactKey = Buffer.alloc(32, 17).toString("base64");
const { requestRefund } = require('../cloudfunctions/payment-api/refund-store');
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Explicit PAYMENT_TEST_MYSQL_PORT required (local test instance only)");
const database = `anime_payment_test_${crypto.randomBytes(8).toString("hex")}`;
const config = { host: "127.0.0.1", port, user: "root", password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || "", supportBigNumbers: true, bigNumberStrings: true };
let admin, pool;
const now = 1788600000000;
const input = (overrides = {}) => ({ orderId: "order_1", buyerId: "buyer", requestKey: "request_0000000001", expectedVersion: 1,
  appid: "test_app", platformMchid: "test_platform", payerOpenid: "test_openid", fee: { version: "TEST_ONLY", amountFen: 100 }, ...overrides });
const result = (payment, overrides = {}) => ({ tradeState: "SUCCESS", combineOutTradeNo: payment.id, outTradeNo: payment.id,
  appid: payment.appid, platformMchid: payment.platform_mchid, subMchid: payment.sub_mchid, payerOpenid: payment.payer_openid, payerVerification: "MATCHED",
  transactionId: `wx_${payment.id}`, totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now + 100, ...overrides });
const code = (expected) => (error) => error.code === expected;
function queryResult(p, tradeState) {
  return notificationFixture.sign(JSON.stringify({ combine_appid: p.appid, combine_mchid: p.platform_mchid, combine_out_trade_no: p.id,
    sub_orders: [{ mchid: p.platform_mchid, sub_mchid: p.sub_mchid, out_trade_no: p.id, trade_state: tradeState }] }), now + 200);
}
async function withNotificationHttp(connectionPool, work) {
  // Local bridge exercises real HTTP status/body delivery. It is not evidence of CloudBase gateway behavior.
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const event = { httpMethod: request.method, headers: request.headers, isBase64Encoded: true, body: Buffer.concat(chunks).toString("base64") };
    const result = await handlePaymentHttp(connectionPool, event, notificationFixture.config, now + 200, () => {});
    response.writeHead(result.statusCode, result.headers); response.end(result.body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { return await work(`http://127.0.0.1:${server.address().port}/payment-notify`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
async function order(id = "order_1") { const [[row]] = await pool.execute("SELECT * FROM order_aggregates WHERE id = ?", [id]); return row; }
async function payments() { const [rows] = await pool.query("SELECT * FROM order_payments ORDER BY created_at, id"); return rows; }
async function seedOrder(id, providerId = "provider") {
  const payload = { public: { amountFen: 10000, paymentStatus: "UNPAID", buyerAgreementConfirmedAt: now,
    communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, executable: true, ndaRequired: false,
    provider: { career: "摄影" }, items: [{ serviceId: "test_service", name: "TEST", finalPriceFen: 10000 }], timeSegments: [{ startsAt: now, endsAt: now + 3600000 }] },
    contactEncrypted: encryptContact({ name: "TEST", wechat: "test_only", phone: "" }, contactKey), events: [] };
  await pool.execute("INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES (?,'buyer',?,?,?,'BUYER_FINAL_CONFIRM',?,?,?)",
    [id, providerId, id, "0".repeat(64), JSON.stringify(payload), now, now]);
}
before(async () => {
  admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  pool = mysql.createPool({ ...config, database, connectionLimit: 12 });
  const folder = path.join(__dirname, "../database/mysql");
  for (const file of fs.readdirSync(folder).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
    if (file === "0019_payment_payer_verification.sql") {
      await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('buyer','buyer','TEST',1,1),('provider','provider','TEST',1,1)");
      await seedOrder("migration_order");
      await pool.query(`INSERT INTO order_payments
        (id,order_id,request_key,order_version,agreement_hash,appid,platform_mchid,sub_mchid,payer_openid,amount_fen,fee_rule_version,platform_fee_fen,status,transaction_id,received_total_fen,payer_paid_fen,received_currency,paid_at,created_at,updated_at)
        VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','migration_order','migration_request',1,REPEAT('0',64),'test_app','test_platform','test_sub','test_openid',10000,'TEST_ONLY',100,'PAID','legacy_verified_transaction',10000,9800,'CNY',1,1,1)`);
    }
    for (const sql of fs.readFileSync(path.join(folder, file), "utf8").replace(/^\s*--.*$/gm, '').split(";").filter((s) => s.trim())) await pool.query(sql);
  }
  const [[migrated]] = await pool.query("SELECT payer_verification FROM order_payments WHERE transaction_id = 'legacy_verified_transaction'");
  assert.equal(migrated.payer_verification, "MATCHED");
  await pool.query("INSERT INTO wechat_identities (account_id,open_id,created_at,updated_at) VALUES ('buyer','test_openid',1,1),('provider','test_provider_openid',1,1)");
  await pool.query("INSERT INTO account_roles VALUES ('buyer','BUYER',1),('provider','PROVIDER',1)");
});
beforeEach(async () => {
  await pool.query('DELETE FROM finance_net_settlements');
  await pool.query('DELETE FROM finance_result_imports');
  await pool.query('DELETE FROM bank_settlement_sources');
  await pool.query('DELETE FROM bank_settlement_batches');
  await pool.query('DELETE FROM fund_postings');
  await pool.query("DELETE FROM fund_journals WHERE event_type='REFUND_SUCCEEDED'");
  await pool.query('DELETE FROM fund_journals');
  await pool.query("DELETE FROM order_refund_reversals");
  await pool.query("DELETE FROM order_refunds");
  await pool.query("DELETE FROM payment_mutation_receipts");
  await pool.query("DELETE FROM order_funds_interlocks");
  await pool.query("DELETE FROM order_settlement_tasks");
  await pool.query("DELETE FROM provider_qualification_reviews");
  await pool.query("DELETE FROM provider_qualifications");
  await pool.query("INSERT INTO provider_qualifications (provider_id,career,status,application,eligibility_verified,reviewed_by,evidence_reference,submitted_at,reviewed_at) VALUES ('provider','摄影','APPROVED','{}',1,'test_reviewer','test_evidence',1,1)");
  await pool.query("DELETE FROM order_payments");
  await pool.query("DELETE FROM order_aggregates");
  await pool.query("DELETE FROM provider_payment_merchants");
  await pool.query("INSERT INTO provider_payment_merchants VALUES ('provider','test_platform','test_sub','READY',1)");
  await seedOrder("order_1");
});
after(async () => {
  if (pool) await pool.end();
  if (admin) {
    assert.match(database, /^anime_payment_test_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});

test("20 concurrent retries create exactly one payment", async () => {
  const rows = await Promise.all(Array.from({ length: 20 }, () => reservePayment(pool, input(), now)));
  assert.equal(new Set(rows.map((p) => p.id)).size, 1);
  assert.equal((await payments()).length, 1);
  assert.equal((await order()).version, 1);
});

test('direct company receipt needs no provider submerchant, binds mode and commits encrypted callbacks exactly once', async () => {
  await pool.query('DELETE FROM provider_payment_merchants');
  const directInput = input({ paymentMode: 'DIRECT', fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' });
  const reserved = await Promise.all(Array.from({ length: 10 }, () => reservePayment(pool, directInput, now)));
  const p = reserved[0];
  assert.equal(new Set(reserved.map(row => row.id)).size, 1);
  assert.equal(p.payment_mode, 'DIRECT'); assert.equal(p.sub_mchid, null);
  await assert.rejects(reservePayment(pool, input(), now), code('PAYMENT_IDEMPOTENCY_CONFLICT'));
  await assert.rejects(recordPaymentSuccess(pool, result(p), now), code('PAYMENT_RESULT_MISMATCH'));
  const transaction = { appid: p.appid, mchid: p.platform_mchid, out_trade_no: p.id, transaction_id: 'direct_receipt',
    trade_type: 'JSAPI', trade_state: 'SUCCESS', payer: { openid: p.payer_openid }, success_time: new Date(now).toISOString(),
    amount: { total: 10000, payer_total: 9800, currency: 'CNY', payer_currency: 'CNY' } };
  for (const patch of [{ mchid: 'other_merchant' }, { payer: { openid: 'other_payer' } }, { appid: 'other_app' }]) {
    await assert.rejects(acceptPaymentNotification(pool, notificationFixture.notify({ ...transaction, ...patch }, now), notificationFixture.config, now), code('PAYMENT_RESULT_MISMATCH'));
  }
  const request = notificationFixture.notify(transaction, now);
  const replies = await Promise.all(Array.from({ length: 5 }, () => acceptPaymentNotification(pool, request, notificationFixture.config, now)));
  assert.ok(replies.every(reply => reply.statusCode === 204));
  assert.equal((await payments())[0].status, 'PAID');
  assert.equal((await order()).version, 2);
});

async function bankSource(orderId='order_1') {
  if(orderId!=='order_1')await seedOrder(orderId);
  const p=await reservePayment(pool,input({orderId,requestKey:`bank_payment_${orderId}`,paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
  await recordPaymentSuccess(pool,result(p,{paymentMode:'DIRECT'}),now+100);
  const row=await order(orderId),payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
  payload.public.completedAt=now+200;
  payload.settlementIntent={status:'PENDING',paymentId:p.id,acceptedOrderVersion:2,createdAt:now+200};
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED',payload=? WHERE id=?",[JSON.stringify(payload),row.id]);
  await pool.execute('INSERT INTO order_funds_interlocks(order_id) VALUES(?)',[row.id]);
  return p;
}
test('bank batch twenty retries reserve one draft and cannot change its sources',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const input={requestKey:'bank_batch_retry_0001',operatorId:'finance',paymentIds:[p.id]};
  const results=await Promise.all(Array.from({length:20},()=>reserveBankBatch(pool,input,scope,now+300)));
  assert.equal(new Set(results.map(r=>r.batchId)).size,1);
  assert.ok(results.every(r=>r.payable===false));
  const [[counts]]=await pool.query('SELECT COUNT(*) AS n,SUM(provider_pretax_fen) AS amount FROM bank_settlement_sources');
  assert.equal(Number(counts.n),1);assert.equal(Number(counts.amount),8000);
  await assert.rejects(reserveBankBatch(pool,{...input,operatorId:'another'},scope,now+300),code('BANK_BATCH_IDEMPOTENCY_CONFLICT'));
});
test('bank request lookup recovers a committed response and isolates scopes without reviving cancelled batches',async()=>{
  const {reserveBankBatch,cancelBankBatch,findBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const input={requestKey:'bank_lost_response_01',operatorId:'finance',paymentIds:[p.id]};
  assert.deepEqual(await findBankBatch(pool,input.requestKey,scope),{found:false,payable:false});
  await reserveBankBatch(pool,input,scope,now+300); // Creation committed; caller has no response/batch ID.
  const recovered=await findBankBatch(pool,input.requestKey,scope);
  assert.equal(recovered.found,true);assert.equal(recovered.status,'RESERVED_DRAFT');assert.equal(recovered.payable,false);
  for(const other of [{...scope,appid:'other'},{...scope,platformMchid:'other'}])
    assert.deepEqual(await findBankBatch(pool,input.requestKey,other),{found:false,payable:false});
  assert.equal((await reserveBankBatch(pool,input,scope,now+350)).batchId,recovered.batchId);
  await cancelBankBatch(pool,{batchId:recovered.batchId,operatorId:'finance',reason:'取消恢复测试草稿'},scope,now+400);
  assert.deepEqual(await findBankBatch(pool,input.requestKey,scope),{...recovered,status:'CANCELLED'});
  const [[counts]]=await pool.query('SELECT COUNT(*) AS n FROM bank_settlement_batches');assert.equal(Number(counts.n),1);
  const [[source]]=await pool.query('SELECT reserved_payment_id,released_at FROM bank_settlement_sources');
  assert.equal(source.reserved_payment_id,null);assert.equal(Number(source.released_at),now+400);
});

test('different concurrent bank batches cannot reserve the same order twice',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const results=await Promise.allSettled(['a','b'].map(key=>reserveBankBatch(pool,{requestKey:`bank_batch_compete_${key}`,operatorId:'finance',paymentIds:[p.id]},scope,now+300)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const [[counts]]=await pool.query('SELECT COUNT(*) AS n FROM bank_settlement_batches');
  assert.equal(Number(counts.n),1);
});
test('bank batch failure on a later disputed order rolls back every earlier reservation',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const a=await bankSource(),b=await bankSource('order_2');
  await pool.execute("UPDATE order_funds_interlocks SET hold_reason='DISPUTE',held_at=? WHERE order_id='order_2'",[now+250]);
  await assert.rejects(reserveBankBatch(pool,{requestKey:'bank_batch_rollback_01',operatorId:'finance',paymentIds:[a.id,b.id]},
    {appid:a.appid,platformMchid:a.platform_mchid},now+300),code('BANK_BATCH_SOURCE_NOT_READY'));
  for(const table of ['bank_settlement_batches','bank_settlement_sources']) {
    const [[counts]]=await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);assert.equal(Number(counts.n),0);
  }
});

test('bank cancellation preserves history, releases once and never revives the old request',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const input={requestKey:'bank_batch_cancel_001',operatorId:'finance',paymentIds:[p.id]};
  const batch=await reserveBankBatch(pool,input,scope,now+300);
  const cancellation={batchId:batch.batchId,operatorId:'reviewer',reason:'取消本期草稿'};
  const results=await Promise.all(Array.from({length:10},()=>cancelBankBatch(pool,cancellation,scope,now+400)));
  assert.ok(results.every(r=>r.status==='CANCELLED'));
  const [[source]]=await pool.execute('SELECT * FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);
  assert.equal(Number(source.released_at),now+400);assert.equal(source.reserved_payment_id,null);
  assert.equal(Number(source.provider_pretax_fen),8000);
  assert.equal((await reserveBankBatch(pool,input,scope,now+500)).status,'CANCELLED');
  const fresh=await reserveBankBatch(pool,{...input,requestKey:'bank_batch_cancel_002'},scope,now+500);
  assert.notEqual(fresh.batchId,batch.batchId);
  await cancelBankBatch(pool,{...cancellation,reason:'重复取消不得覆盖'},scope,now+600);
  const [[original]]=await pool.execute('SELECT cancellation_reason,cancelled_at FROM bank_settlement_batches WHERE id=?',[batch.batchId]);
  assert.equal(original.cancellation_reason,cancellation.reason);assert.equal(Number(original.cancelled_at),now+400);
  const [[active]]=await pool.query('SELECT COUNT(*) AS n FROM bank_settlement_sources WHERE released_at IS NULL');
  assert.equal(Number(active.n),1);
});
test('foreign-scope bank cancellation cannot release another merchant funds',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_scope_cancel_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  for(const foreign of [{...scope,appid:'other'},{...scope,platformMchid:'other'}]) {
    await assert.rejects(cancelBankBatch(pool,{batchId:batch.batchId,operatorId:'finance',reason:'取消'},foreign,now+400),code('BANK_BATCH_NOT_FOUND'));
  }
  const [[source]]=await pool.execute('SELECT released_at FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);
  assert.equal(source.released_at,null);
});
test('bank cancellation failure rolls back released amounts and leaves original draft intact',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_cancel_failure_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  const faulty={async getConnection(){const c=await pool.getConnection();return new Proxy(c,{get(target,key){
    if(key==='execute')return async(sql,params)=>{
      if(sql.startsWith('UPDATE bank_settlement_batches'))throw Error('injected cancellation failure');
      return target.execute(sql,params);
    };
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});}};
  await assert.rejects(cancelBankBatch(faulty,{batchId:batch.batchId,operatorId:'finance',reason:'取消'},scope,now+400),/injected/);
  const [[source]]=await pool.execute('SELECT released_at FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);
  const [[saved]]=await pool.execute('SELECT status FROM bank_settlement_batches WHERE id=?',[batch.batchId]);
  assert.equal(source.released_at,null);assert.equal(saved.status,'RESERVED_DRAFT');
});

test('bank snapshot shares caller transaction and does not commit its changes',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview,readBankBatchSnapshot}=require('../cloudfunctions/payment-api/bank-batch-review');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_shared_snapshot_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    await connection.execute('UPDATE bank_settlement_sources SET released_at=? WHERE batch_id=?',[now+400,batch.batchId]);
    const review=await readBankBatchSnapshot(connection,batch.batchId,scope);
    assert.ok(review.records[0].blockers.includes('SOURCE_RELEASED'));
    await connection.rollback();
  }finally{connection.release();}
  const review=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(review.records[0].blockers.includes('SOURCE_RELEASED'),false);
});

test('bank batch recheck detects a later real refund and preserves the original reserved amount',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_refund_recheck_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  const initial=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(initial.sourcesUnchanged,true);assert.equal(initial.payable,false);
  const request={orderId:'order_1',paymentId:p.id,buyerId:'buyer',requestKey:'bank_refund_request_01',amountFen:3000,reason:'协商退款'};
  await assert.rejects(requestRefund(pool,request,p.platform_mchid,now+350),code('REFUND_ORDER_COMPLETED'));
  // Historical pre-policy refund fixture: new completed-order requests are forbidden above.
  await pool.execute("UPDATE order_aggregates SET stage='IN_PRODUCTION' WHERE id='order_1'");
  const refund=await requestRefund(pool,request,p.platform_mchid,now+350);
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED' WHERE id='order_1'");
  const pending=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(pending.sourcesUnchanged,false);assert.ok(pending.records[0].blockers.includes('REFUND_UNRESOLVED'));
  await reviewRefund(pool,reviewInput(refund.id),now+400);
  await claimRefund(pool,refund.id,refundConfig,now+450);
  await recordRefundResult(pool,refundReceipt(refund),now+600);
  const changed=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(changed.sourcesUnchanged,false);assert.equal(changed.records[0].currentAmounts.providerPretaxFen,5600);
  assert.equal(changed.records[0].reservedProviderPretaxFen,8000);
  assert.equal(changed.records[0].payment.refundedFen,'3000');
  assert.equal(changed.records[0].payment.totalFen,'10000');
  assert.equal(changed.records[0].payment.transactionId,`wx_${p.id}`);
  const csv=require('../scripts/bank-finance-export').financeCsv(changed);
  assert.ok(csv.includes('"56.00"'));assert.ok(csv.includes('"80.00"'));assert.ok(csv.includes('"30.00"'));
  assert.ok(csv.includes('SOURCE_SNAPSHOT_CHANGED'));assert.ok(csv.includes('待补充'));
  assert.ok(changed.records[0].blockers.includes('SOURCE_SNAPSHOT_CHANGED'));
  const [[stored]]=await pool.execute('SELECT provider_pretax_fen FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);
  assert.equal(Number(stored.provider_pretax_fen),8000);
});
test('bank recheck refuses foreign scope and reports cancelled or changed source orders',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_review_scope_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  for(const foreign of [{...scope,appid:'other'},{...scope,platformMchid:'other'}])
    await assert.rejects(readBankBatchReview(pool,batch.batchId,foreign),/BANK_BATCH_NOT_FOUND/);
  await pool.execute("UPDATE order_aggregates SET version=version+1 WHERE id='order_1'");
  assert.ok((await readBankBatchReview(pool,batch.batchId,scope)).records[0].blockers.includes('SOURCE_SNAPSHOT_CHANGED'));
  await cancelBankBatch(pool,{batchId:batch.batchId,operatorId:'finance',reason:'重建'},scope,now+400);
  const cancelled=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(cancelled.sourcesUnchanged,false);
  assert.ok(cancelled.records[0].blockers.includes('BATCH_NOT_RESERVED_DRAFT'));
  assert.ok(cancelled.records[0].blockers.includes('SOURCE_RELEASED'));
});

test('bank batch review detects balanced but incorrect ledger postings without repairing them',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_ledger_review_01',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
  assert.deepEqual((await readBankBatchReview(pool,batch.batchId,scope)).records[0].ledgerIssues,[]);
  await pool.execute("UPDATE fund_postings SET amount_fen=CASE account WHEN 'PLATFORM_PENDING' THEN 1999 WHEN 'PROVIDER_PENDING' THEN 8001 ELSE amount_fen END WHERE journal_id=?",[`payment:${p.id}`]);
  const review=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(review.sourcesUnchanged,false);assert.equal(review.payable,false);
  assert.ok(review.records[0].blockers.includes('LEDGER_MISMATCH'));
  assert.ok(review.records[0].ledgerIssues.some(issue=>issue.code==='POSTING_AMOUNT_MISMATCH'));
  const [[entry]]=await pool.execute("SELECT amount_fen FROM fund_postings WHERE journal_id=? AND account='PLATFORM_PENDING'",[`payment:${p.id}`]);
  assert.equal(Number(entry.amount_fen),1999);
  await pool.execute('DELETE FROM fund_postings WHERE journal_id=?',[`payment:${p.id}`]);
  await pool.execute('DELETE FROM fund_journals WHERE id=?',[`payment:${p.id}`]);
  assert.ok((await readBankBatchReview(pool,batch.batchId,scope)).records[0].ledgerIssues.some(issue=>issue.code==='PAYMENT_JOURNAL_MISSING'));
});

test('bank batch review rejects missing sources even when remaining orders are valid',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const a=await bankSource(),b=await bankSource('order_2');
  const scope={appid:a.appid,platformMchid:a.platform_mchid};
  const batch=await reserveBankBatch(pool,{requestKey:'bank_source_integrity_01',operatorId:'finance',paymentIds:[b.id,a.id]},scope,now+300);
  assert.equal((await readBankBatchReview(pool,batch.batchId,scope)).sourcesUnchanged,true);
  await pool.execute('DELETE FROM bank_settlement_sources WHERE batch_id=? AND payment_id=?',[batch.batchId,b.id]);
  const missing=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(missing.records.length,1);assert.deepEqual(missing.records[0].blockers,[]);
  assert.deepEqual(missing.batchBlockers,['BATCH_SOURCES_MISMATCH']);assert.equal(missing.sourcesUnchanged,false);
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);
  assert.equal(Number(count.n),1);
});

test('bank draft lifecycle works with proposed new-table grants and existing locking rights without deletes or ledger edits',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid};
  const user=`bank_${crypto.randomBytes(6).toString('hex')}`,password=crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try{
    for(const table of ['order_aggregates','order_payments','order_refunds','order_funds_interlocks','order_refund_reversals','fund_journals','fund_postings','finance_result_imports','finance_net_settlements'])
      await admin.query(`GRANT SELECT ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    // Existing payment-account rights are needed for MySQL SELECT ... FOR UPDATE.
    for(const table of ['order_aggregates','order_payments','order_refunds','order_funds_interlocks'])
      await admin.query(`GRANT UPDATE ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    for(const table of ['bank_settlement_batches','bank_settlement_sources'])
      await admin.query(`GRANT SELECT,INSERT,UPDATE ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    restricted=mysql.createPool({...config,database,user,password,connectionLimit:3});
    const batch=await reserveBankBatch(restricted,{requestKey:'bank_restricted_0001',operatorId:'finance',paymentIds:[p.id]},scope,now+300);
    assert.equal((await readBankBatchReview(restricted,batch.batchId,scope)).sourcesUnchanged,true);
    const denied=error=>error.code==='ER_TABLEACCESS_DENIED_ERROR';
    for(const sql of ['DELETE FROM bank_settlement_batches WHERE 1=0','DELETE FROM bank_settlement_sources WHERE 1=0',
      'UPDATE fund_postings SET amount_fen=amount_fen WHERE 1=0'])
      await assert.rejects(restricted.query(sql),denied);
    await cancelBankBatch(restricted,{batchId:batch.batchId,operatorId:'finance',reason:'测试取消'},scope,now+400);
    assert.equal((await readBankBatchReview(restricted,batch.batchId,scope)).status,'CANCELLED');
  }finally{
    if(restricted)await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});

test('bank preview reads real MySQL snapshots and blocks unaccepted, held and foreign payments without writes', async () => {
  const { readBankSettlementPreview } = require('../cloudfunctions/payment-api/bank-settlement-preview');
  const p = await reservePayment(pool, input({ paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1' }), now);
  await recordPaymentSuccess(pool,result(p,{paymentMode:'DIRECT'}),now+100);
  const scope={appid:p.appid,platformMchid:p.platform_mchid};
  let preview=await readBankSettlementPreview(pool,p.id,scope);
  assert.equal(preview.amounts.providerPretaxFen,8000);
  assert.ok(preview.blockers.includes('ORDER_ACCEPTANCE_UNVERIFIED'));
  assert.ok(preview.blockers.includes('FUNDS_INTERLOCK_MISSING'));
  const row=await order(),payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
  payload.public.completedAt=now+200;
  payload.settlementIntent={status:'PENDING',paymentId:p.id,acceptedOrderVersion:2,createdAt:now+200};
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED',payload=? WHERE id=?",[JSON.stringify(payload),row.id]);
  await pool.execute('INSERT INTO order_funds_interlocks (order_id) VALUES (?)',[row.id]);
  const before=JSON.stringify(await payments());
  preview=await readBankSettlementPreview(pool,p.id,scope);
  assert.deepEqual(preview.blockers,['LEDGER_AND_PRIOR_PAYOUT_CHECK_REQUIRED','BANK_ACCOUNT_AND_TAX_CHECK_REQUIRED']);
  assert.equal(preview.payable,false);
  assert.equal(JSON.stringify(await payments()),before);
  await pool.execute("UPDATE order_funds_interlocks SET hold_reason='DISPUTE',held_at=? WHERE order_id=?",[now+300,row.id]);
  assert.ok((await readBankSettlementPreview(pool,p.id,scope)).blockers.includes('FUNDS_HELD'));
  await assert.rejects(readBankSettlementPreview(pool,p.id,{...scope,platformMchid:'foreign'}),/PAYMENT_NOT_FOUND/);
  await assert.rejects(readBankSettlementPreview(pool,p.id,{...scope,appid:'foreign'}),/PAYMENT_NOT_FOUND/);
});

test('direct payments cannot enter old ecommerce submerchant settlement', async () => {
  await pool.query('DELETE FROM provider_payment_merchants');
  const p = await reservePayment(pool, input({ paymentMode: 'DIRECT', fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' }), now);
  await recordPaymentSuccess(pool, result(p, { paymentMode: 'DIRECT' }), now + 100);
  const row = await order(), payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  payload.public.completedAt = now + 200;
  payload.settlementIntent = { status: 'PENDING', paymentId: p.id, acceptedOrderVersion: 2, createdAt: now + 200 };
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED', payload=? WHERE id=?", [JSON.stringify(payload), row.id]);
  await assert.rejects(prepareSettlement(pool, row.id, now + 300), code('DIRECT_SETTLEMENT_NOT_ENABLED'));
});

test('direct prepay reaches signed cashier preparation without provider merchant and reuses the saved channel order', async () => {
  const { preparePaymentSession } = require('../cloudfunctions/payment-api/prepay-session');
  const { createPrepay } = require('../cloudfunctions/payment-api/wechat-prepay');
  const { createPayment } = require('../cloudfunctions/payment-api/payment-create');
  await pool.query('DELETE FROM provider_payment_merchants');
  const config = { ...queryFixture.config, appid: 'test_app', paymentMode: 'DIRECT', prepayEnabled: true,
    notifyUrl: 'https://example.test/payment' };
  let calls = 0;
  const channel = (payment, cfg) => createPrepay(payment, cfg,
    queryFixture.requestFor(notificationFixture.sign('{"prepay_id":"direct_test_session"}', now), options => {
      calls++; assert.equal(options.path, '/v3/pay/transactions/jsapi');
    }), () => now);
  const prepare = (db, id, cfg) => preparePaymentSession(db, id, cfg, channel, () => now);
  const event = { action: 'createPayment', orderId: 'order_1', requestKey: 'direct_cashier_request', expectedVersion: 1 };
  const caller = { WX_OPENID: 'test_openid', WX_APPID: 'test_app' };
  const first = await createPayment(pool, event, caller, config, prepare, () => now);
  const second = await createPayment(pool, event, caller, config, prepare, () => now);
  assert.equal(first.status, 'READY'); assert.equal(second.status, 'READY');
  assert.equal(first.paymentRequest.package, 'prepay_id=direct_test_session'); assert.equal(calls, 1);
  assert.equal((await payments())[0].payment_mode, 'DIRECT');
  assert.equal(Number((await payments())[0].platform_fee_fen), 2000);
});

async function seedAcceptedSettlement(overrides = {}) {
  const payment = await reservePayment(pool, input(overrides), now);
  await recordPaymentSuccess(pool, result(payment), now + 100);
  const row = await order(), payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  payload.public.provider.career = '妆娘';
  payload.public.deliveryNote = 'TEST onsite delivery completed';
  await pool.execute("UPDATE order_aggregates SET stage='DELIVERY_PENDING', payload=? WHERE id=?", [JSON.stringify(payload), row.id]);
  await handleOrder(databaseReader(), { action: 'transitionOrder', orderId: row.id,
    expectedVersion: Number(row.version), event: 'BUYER_ACCEPTS_DELIVERY' },
  { WX_OPENID: 'test_openid' }, contactKey, now + 200);
  return payment;
}

const { executeSettlement } = require('../cloudfunctions/payment-api/settlement-executor');
const settlementConfig = { appid: 'test_app', platformMchid: 'test_platform', settlementEnabled: true, settlementExecutionEnabled: true };
const standardFee = { fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' };

test('durable replay guard grants one of twenty identical signed requests and survives a new database connection', async () => {
  const { consumeMutation } = require('../cloudfunctions/payment-api/mutation-replay-guard');
  const { buildSignedRequest } = require('../cloudfunctions/payment-api/wechat-query');
  const relayConfig = { enabled: true, mutationsEnabled: true, platformMchid: queryFixture.config.platformMchid,
    merchantSerial: queryFixture.config.merchantSerial, wechatPublicKeyId: queryFixture.config.wechatPublicKeyId,
    merchantPublicKey: queryFixture.publicKey.export({ type: 'spki', format: 'pem' }) };
  const path = '/v3/ecommerce/profitsharing/orders', body = '{}';
  const options = buildSignedRequest('POST', path, body, queryFixture.config, now);
  const event = { path, body, authorization: options.headers.Authorization };
  const results = await Promise.all(Array.from({ length: 20 }, () => consumeMutation(pool, event, relayConfig, () => now)));
  assert.equal(results.filter(Boolean).length, 1);
  const fresh = await mysql.createConnection({ ...config, database });
  try { assert.equal(await consumeMutation(fresh, event, relayConfig, () => now + 100), false); }
  finally { await fresh.end(); }
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM payment_mutation_receipts');
  assert.equal(Number(count.n), 1);
  await assert.rejects(consumeMutation(pool, { ...event, body: '{ }' }, relayConfig, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  const user = `replay_${crypto.randomBytes(6).toString('hex')}`, password = crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    await admin.query(`GRANT INSERT ON \`${database}\`.payment_mutation_receipts TO '${user}'@'127.0.0.1'`);
    restricted = await mysql.createConnection({ ...config, database, user, password });
    const next = { ...event, authorization: buildSignedRequest('POST', path, body, queryFixture.config, now).headers.Authorization };
    assert.equal(await consumeMutation(restricted, next, relayConfig, () => now), true);
    assert.equal(await consumeMutation(restricted, next, relayConfig, () => now), false);
    for (const sql of ['SELECT * FROM payment_mutation_receipts', 'DELETE FROM payment_mutation_receipts',
      'UPDATE payment_mutation_receipts SET consumed_at=1']) {
      await assert.rejects(restricted.execute(sql), error => [1142,1143].includes(error.errno));
    }
  } finally {
    if (restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});

test('twenty public relay replays open exactly one HTTP request with a real durable guard', async () => {
  const { consumeMutation } = require('../cloudfunctions/payment-api/mutation-replay-guard');
  const { relayMutation } = require('../cloudfunctions/payment-api/mutation-relay');
  const { buildSignedRequest } = require('../cloudfunctions/payment-api/wechat-query');
  const relayConfig = { enabled: true, mutationsEnabled: true, appid: 'test_app', platformMchid: queryFixture.config.platformMchid,
    merchantSerial: queryFixture.config.merchantSerial, wechatPublicKeyId: queryFixture.config.wechatPublicKeyId,
    merchantPublicKey: queryFixture.publicKey.export({ type: 'spki', format: 'pem' }) };
  const path = '/v3/ecommerce/profitsharing/orders';
  const body = JSON.stringify({ appid: 'test_app', sub_mchid: '1900000002', transaction_id: '420000000001',
    out_order_no: 'a'.repeat(32), finish: true, receivers: [{ type: 'MERCHANT_ID', receiver_account: relayConfig.platformMchid, amount: 2000 }] });
  const event = { path, body, authorization: buildSignedRequest('POST', path, body, queryFixture.config, now).headers.Authorization };
  let posts = 0;
  const request = queryFixture.requestFor({ statusCode: 200, headers: {}, body: Buffer.from('{}') }, () => { posts++; });
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => relayMutation(event, relayConfig, request, () => now,
    input => consumeMutation(pool, input, relayConfig, () => now))));
  assert.equal(posts, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'PAYMENT_RELAY_REJECTED'));
});

test('lost replay consumption acknowledgement remains consumed in MySQL', async () => {
  const { consumeMutation } = require('../cloudfunctions/payment-api/mutation-replay-guard');
  const { buildSignedRequest } = require('../cloudfunctions/payment-api/wechat-query');
  const relayConfig = { enabled: true, mutationsEnabled: true, platformMchid: queryFixture.config.platformMchid,
    merchantSerial: queryFixture.config.merchantSerial, wechatPublicKeyId: queryFixture.config.wechatPublicKeyId,
    merchantPublicKey: queryFixture.publicKey.export({ type: 'spki', format: 'pem' }) };
  const path = '/v3/ecommerce/profitsharing/orders', body = '{}';
  const event = { path, body, authorization: buildSignedRequest('POST', path, body, queryFixture.config, now).headers.Authorization };
  const uncertain = { async execute(...args) { await pool.execute(...args); throw Error('insert acknowledgement lost'); } };
  await assert.rejects(consumeMutation(uncertain, event, relayConfig, () => now), /acknowledgement lost/);
  assert.equal(await consumeMutation(pool, event, relayConfig, () => now + 100), false);
});


for (const currentStatus of ['PROCESSING', 'FEE_SUCCEEDED', 'CLOSED']) test(`late settlement not-found preserves concurrent verified ${currentStatus}`, async () => {
  await seedAcceptedSettlement(standardFee);
  let taskId;
  const operation = executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    taskId = claim.taskId;
    if (action === 'SUBMIT') return { status: 'PROCESSING' };
    await recordSettlementResult(pool, taskId, { status: currentStatus, channelOrderId: 'channel_1',
      platformFeeFen: 2000, detailId: 'detail_1', finishedAt: now + 350, finishAmountFen: null }, now + 350);
    return { status: 'NOT_FOUND' };
  }, () => now + 300);
  if (currentStatus === 'PROCESSING') await assert.rejects(operation, { code: 'SETTLEMENT_RESULT_CONFLICT' });
  else assert.equal((await operation).status, currentStatus);
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks WHERE id=?', [taskId]);
  assert.equal(task.status, currentStatus); assert.equal(task.channel_order_id, 'channel_1');
  assert.equal(task.lease_token, null);
});

test('persisted refund or dispute hold blocks settlement despite permissive external risk check', async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  await seedAcceptedSettlement(standardFee);
  assert.deepEqual(await holdOrderFunds(pool, 'order_1', 'REFUND_REQUEST', now + 250), { status: 'HELD', reason: 'REFUND_REQUEST' });
  assert.equal((await executeSettlement(pool, 'order_1', settlementConfig, async () => true,
    () => assert.fail('held funds must not reach channel'), () => now + 300)).status, 'DEFERRED');
  assert.deepEqual(await holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 350), { status: 'HELD', reason: 'DISPUTE' });
  assert.deepEqual(await holdOrderFunds(pool, 'order_1', 'REFUND_REQUEST', now + 360), { status: 'HELD', reason: 'DISPUTE' });
  const [[hold]] = await pool.execute('SELECT hold_reason,held_at FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'DISPUTE');
  assert.equal(Number(hold.held_at), now + 250);
  assert.equal((await executeSettlement(pool, 'order_1', settlementConfig, async () => true,
    () => assert.fail('disputed funds must not reach channel'), () => now + 370)).status, 'DEFERRED');
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(task.attempts, 0);
});

test('a hold arriving after settlement fence requires reconciliation, never direct refund approval', async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  await seedAcceptedSettlement(standardFee);
  let posts = 0;
  await executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    if (action === 'SUBMIT') {
      posts++;
      assert.equal((await holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 310)).status, 'SETTLEMENT_REVIEW_REQUIRED');
    }
    return { status: 'PROCESSING', channelOrderId: 'channel_1' };
  }, () => now + 300);
  const [[guard]] = await pool.execute('SELECT * FROM order_funds_interlocks');
  assert.equal(guard.hold_reason, 'DISPUTE'); assert.ok(guard.settlement_task_id);
  await executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    assert.equal(action, 'QUERY'); return { status: 'PROCESSING', channelOrderId: 'channel_1' };
  }, () => now + 400);
  assert.equal(posts, 1);
});

test('concurrent hold and settlement fence cannot both win unrestricted funds', async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  const { authorizeSettlementSubmission } = require('../cloudfunctions/payment-api/settlement-store');
  await seedAcceptedSettlement(standardFee);
  const claim = await claimSettlement(pool, 'order_1', now + 300);
  const [held, permitted] = await Promise.all([
    holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 301),
    authorizeSettlementSubmission(pool, 'order_1', claim.taskId, claim.leaseToken, () => now + 301)
  ]);
  assert.equal(held.status, permitted ? 'SETTLEMENT_REVIEW_REQUIRED' : 'HELD');
  const [[guard]] = await pool.execute('SELECT * FROM order_funds_interlocks');
  assert.equal(Boolean(guard.settlement_task_id), permitted);
});

test('merchant eligibility changed after risk check prevents settlement submission', async () => {
  await seedAcceptedSettlement(standardFee);
  await assert.rejects(executeSettlement(pool, 'order_1', settlementConfig, async () => {
    await pool.execute('UPDATE provider_payment_merchants SET verified_at=0'); return true;
  }, () => assert.fail('unverified recipient must not receive funds'), () => now + 300), { code: 'PAYMENT_MERCHANT_NOT_READY' });
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_funds_interlocks');
  assert.equal(Number(count.n), 0);
});

for (const mode of ['lost-acknowledgement', 'expired-after-commit']) test(`settlement fence ${mode} preserves unknown submission and prevents another POST`, async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  await seedAcceptedSettlement(standardFee);
  let commits = 0, time = now + 300;
  const delayed = { execute: (...args) => pool.execute(...args), async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, key) {
      if (key === 'commit') return async () => {
        await target.commit();
        if (++commits === 2) {
          if (mode === 'lost-acknowledgement') throw new Error('fence commit response lost');
          time += 30001;
        }
      };
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    } });
  } };
  const operation = executeSettlement(delayed, 'order_1', settlementConfig, async () => true,
    () => assert.fail('uncertain or expired commit cannot submit'), () => time);
  if (mode === 'lost-acknowledgement') await assert.rejects(operation, /fence commit response lost/);
  else assert.equal((await operation).status, 'QUERY_REQUIRED');
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(task.attempts, 1);
  assert.equal((await holdOrderFunds(pool, 'order_1', 'REFUND_REQUEST', time + 1)).status, 'SETTLEMENT_REVIEW_REQUIRED');
  assert.equal((await executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    assert.equal(action, 'QUERY'); return { status: 'NOT_FOUND' };
  }, () => time + 2)).status, 'QUERY_REQUIRED');
});

test('concurrent settlement executors submit once and never treat POST success as final', async () => {
  await seedAcceptedSettlement(standardFee);
  let posts = 0, queries = 0;
  const channel = async (claim, action) => {
    assert.equal(claim.snapshot.platformFeeFen, 2000);
    if (action === 'SUBMIT') { posts++; return { status: 'FEE_SUCCEEDED' }; }
    queries++; return { status: 'PROCESSING', channelOrderId: 'channel_1' };
  };
  await Promise.all(Array.from({ length: 12 }, () => executeSettlement(pool, 'order_1', settlementConfig, async () => true, channel, () => now + 300)));
  assert.equal(posts, 1); assert.ok(queries >= 1);
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(task.status, 'PROCESSING');
});

test('lost settlement response recovers by query even when merchant and order eligibility change', async () => {
  await seedAcceptedSettlement(standardFee);
  let posts = 0, taskId;
  await assert.rejects(executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    taskId = claim.taskId;
    if (action === 'SUBMIT') posts++;
    throw new Error('response lost');
  }, () => now + 300), /response lost/);
  await pool.execute("UPDATE provider_payment_merchants SET verified_at=0");
  await pool.execute("UPDATE order_aggregates SET stage='DELIVERY_PENDING'");
  const recovered = await executeSettlement(pool, 'order_1', settlementConfig, () => assert.fail('recovery must not authorize another POST'), async (claim, action) => {
    assert.equal(action, 'QUERY'); assert.equal(claim.taskId, taskId);
    return { status: 'FEE_SUCCEEDED', channelOrderId: 'channel_1', platformFeeFen: 2000,
      detailId: 'detail_1', finishedAt: now + 400, finishAmountFen: null };
  }, () => now + 500);
  assert.equal(posts, 1); assert.equal(recovered.status, 'FEE_SUCCEEDED');
});

for (const reason of ['risk', 'risk-error', 'expired', 'replaced', 'clock-backwards', 'insufficient-time', 'guard-budget']) test(`unsubmitted settlement is safely deferred: ${reason}`, async () => {
  await seedAcceptedSettlement(standardFee);
  let time = now + 300;
  const successor = 'e'.repeat(32);
  const risk = async () => {
    if (reason === 'risk') return false;
    if (reason === 'risk-error') throw new Error('risk unavailable');
    if (reason === 'expired') time += 30001;
    if (reason === 'clock-backwards') time--;
    if (reason === 'insufficient-time') time += 29000;
    if (reason === 'guard-budget') time += 17000;
    if (reason === 'replaced') await pool.execute('UPDATE order_settlement_tasks SET lease_token=?', [successor]);
    return true;
  };
  const operation = executeSettlement(pool, 'order_1', settlementConfig, risk, () => assert.fail('no channel call allowed'), () => time);
  if (reason === 'risk-error') await assert.rejects(operation, /risk unavailable/);
  else assert.equal((await operation).status, 'DEFERRED');
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  if (reason === 'replaced') { assert.equal(task.lease_token, successor); assert.equal(task.attempts, 1); return; }
  assert.equal(task.attempts, 0); assert.equal(task.lease_token, null);
  let posts = 0;
  await executeSettlement(pool, 'order_1', settlementConfig, async () => true, async (claim, action) => {
    assert.equal(claim.taskId, task.id);
    if (action === 'SUBMIT') posts++;
    return { status: 'PROCESSING', channelOrderId: 'channel_1' };
  }, () => time + 1);
  assert.equal(posts, 1);
});

test('settlement rejects a nonstandard fee before touching the channel and preserves retryability', async () => {
  await seedAcceptedSettlement();
  await assert.rejects(executeSettlement(pool, 'order_1', settlementConfig, async () => true,
    () => assert.fail('wrong fee must not submit'), () => now + 300), { code: 'SETTLEMENT_SNAPSHOT_CONFLICT' });
  const [[task]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(task.attempts, 0);
});

test('settlement executor verifies signed channel responses before committing twenty percent result', async () => {
  const p = await seedAcceptedSettlement(standardFee);
  const merchant = queryFixture.config.platformMchid;
  await pool.execute("UPDATE order_payments SET platform_mchid=?,sub_mchid='1900000002',transaction_id='420000000001' WHERE id=?", [merchant, p.id]);
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002'", [merchant]);
  await pool.execute("UPDATE order_aggregates SET payload=JSON_SET(payload,'$.public.paymentTransactionId','420000000001')");
  const config = { ...queryFixture.config, ...settlementConfig, platformMchid: merchant, platformReceiverName: '测试平台有限公司' };
  const { callSettlement } = require('../cloudfunctions/payment-api/wechat-settlement');
  let posts = 0, corrupt = true;
  const channel = async (claim, action, runtime, request, clock) => {
    if (action === 'SUBMIT') posts++;
    const body = { sub_mchid: '1900000002', transaction_id: '420000000001', out_order_no: claim.taskId,
      order_id: '300000000001', status: 'FINISHED', receivers: [{ type: 'MERCHANT_ID', receiver_account: merchant,
        amount: 2000, result: 'SUCCESS', detail_id: '360000000001', finish_time: new Date(now + 300).toISOString() }] };
    const response = notificationFixture.sign(JSON.stringify(body), clock());
    if (action === 'QUERY' && corrupt) response.body = Buffer.concat([response.body, Buffer.from(' ')]);
    return callSettlement(claim, action, runtime, queryFixture.requestFor(response), clock);
  };
  await assert.rejects(executeSettlement(pool, 'order_1', config, async () => true, channel, () => now + 400), { code: 'PAYMENT_SIGNATURE_INVALID' });
  const [[pending]] = await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(pending.status, 'PROCESSING'); assert.equal(Number(pending.verified_at), 0);
  corrupt = false;
  assert.equal((await executeSettlement(pool, 'order_1', config, async () => true, channel, () => now + 500)).status, 'FEE_SUCCEEDED');
  assert.equal(posts, 1);
});

test('payment reservation, prepay checks and settlement work with read-only merchant access', async () => {
  const user = `pay_${crypto.randomBytes(6).toString('hex')}`, password = crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    for (const [table, privileges] of [['accounts', 'SELECT'], ['wechat_identities', 'SELECT'], ['account_roles', 'SELECT'],
      ['provider_payment_merchants', 'SELECT'], ['order_aggregates', 'SELECT, UPDATE'],
      ['order_payments', 'SELECT, INSERT, UPDATE'], ['order_settlement_tasks', 'SELECT, INSERT, UPDATE']]) {
      await admin.query(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    restricted = mysql.createPool({ ...config, database, user, password, connectionLimit: 4 });
    const payment = await reservePayment(restricted, input(), now);
    const { preparePaymentSession } = require('../cloudfunctions/payment-api/prepay-session');
    await assert.rejects(preparePaymentSession(restricted, payment.id, { prepayEnabled: false },
      () => assert.fail('No external payment request allowed'), () => now + 1), code('PAYMENT_PREPAY_NOT_ENABLED'));
    await seedAcceptedSettlement();
    assert.match((await prepareSettlement(restricted, 'order_1', now + 300)).id, /^[a-f0-9]{32}$/);
    await assert.rejects(restricted.execute("UPDATE provider_payment_merchants SET status='SUSPENDED' WHERE provider_id='provider'"),
      error => [1142, 1143].includes(error.errno));
  } finally {
    if (restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});

test('funds interlock works with exact payment privileges and cannot delete or change a merchant', async () => {
  const { holdOrderFunds } = require('../cloudfunctions/payment-api/funds-interlock');
  const user = `fund_${crypto.randomBytes(6).toString('hex')}`, password = crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    for (const [table, privileges] of [['provider_payment_merchants', 'SELECT'], ['order_aggregates', 'SELECT, UPDATE'],
      ['order_payments', 'SELECT, INSERT, UPDATE'], ['order_settlement_tasks', 'SELECT, INSERT, UPDATE'],
      ['order_funds_interlocks', 'SELECT, INSERT, UPDATE']]) {
      await admin.query(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    restricted = mysql.createPool({ ...config, database, user, password, connectionLimit: 4 });
    await seedAcceptedSettlement(standardFee);
    let posts = 0;
    await executeSettlement(restricted, 'order_1', settlementConfig, async () => true, async (claim, action) => {
      if (action === 'SUBMIT') posts++;
      return { status: 'PROCESSING', channelOrderId: 'channel_1' };
    }, () => now + 300);
    assert.equal(posts, 1);
    assert.equal((await holdOrderFunds(restricted, 'order_1', 'DISPUTE', now + 301)).status, 'SETTLEMENT_REVIEW_REQUIRED');
    await seedOrder('held_order');
    assert.equal((await holdOrderFunds(restricted, 'held_order', 'REFUND_REQUEST', now + 302)).status, 'HELD');
    for (const sql of ["DELETE FROM order_funds_interlocks WHERE order_id='held_order'",
      "UPDATE provider_payment_merchants SET verified_at=0 WHERE provider_id='provider'"]) {
      await assert.rejects(restricted.execute(sql), error => [1142, 1143].includes(error.errno));
    }
  } finally {
    if (restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});

test("settlement preparation persists one immutable payment snapshot under 20 concurrent retries", async () => {
  const payment = await seedAcceptedSettlement();
  const tasks = await Promise.all(Array.from({ length: 20 }, () => prepareSettlement(pool, 'order_1', now + 300)));
  assert.equal(new Set(tasks.map(task => task.id)).size, 1);
  assert.match(tasks[0].id, /^[a-f0-9]{32}$/);
  const snapshot = typeof tasks[0].request_snapshot === 'string' ? JSON.parse(tasks[0].request_snapshot) : tasks[0].request_snapshot;
  assert.equal(snapshot.paymentId, payment.id);
  assert.equal(snapshot.platformFeeFen, 100);
  assert.equal(snapshot.totalFen, 10000);
  await pool.execute("UPDATE order_payments SET platform_fee_fen=200 WHERE id=?", [payment.id]);
  await assert.rejects(prepareSettlement(pool, 'order_1', now + 400), code('SETTLEMENT_SNAPSHOT_CONFLICT'));
  const [[stored]] = await pool.query("SELECT COUNT(*) AS total FROM order_settlement_tasks");
  assert.equal(Number(stored.total), 1);
});

test("settlement leases serialize workers and recover unknown outcomes with the original request id", async () => {
  await seedAcceptedSettlement();
  const claims = await Promise.all(Array.from({ length: 20 }, () => claimSettlement(pool, 'order_1', now + 300)));
  const active = claims.filter(item => item.status === 'CLAIMED');
  assert.equal(active.length, 1);
  assert.equal(active[0].nextAction, 'SUBMIT');
  assert.equal(claims.filter(item => item.status === 'BUSY').length, 19);
  const next = await claimSettlement(pool, 'order_1', now + 300 + SETTLEMENT_LEASE_MS);
  assert.equal(next.taskId, active[0].taskId);
  assert.equal(next.nextAction, 'QUERY');
  assert.equal(await releaseSettlement(pool, active[0].taskId, active[0].leaseToken), false);
  assert.equal((await claimSettlement(pool, 'order_1', now + 301 + SETTLEMENT_LEASE_MS)).status, 'BUSY');
  assert.equal(await releaseSettlement(pool, next.taskId, next.leaseToken), true);
  const retry = await claimSettlement(pool, 'order_1', now + 302 + SETTLEMENT_LEASE_MS);
  assert.equal(retry.nextAction, 'QUERY');
  assert.equal(retry.taskId, next.taskId);
});

test("settlement rejects unaccepted, unverified, mismatched merchant and wrong payment facts", async () => {
  await assert.rejects(prepareSettlement(pool, 'order_1', now + 300), code('SETTLEMENT_NOT_ACCEPTED'));
  const payment = await seedAcceptedSettlement();
  await pool.query("UPDATE provider_payment_merchants SET status='SUSPENDED'");
  await assert.rejects(prepareSettlement(pool, 'order_1', now + 300), code('PAYMENT_MERCHANT_NOT_READY'));
  await pool.query("UPDATE provider_payment_merchants SET status='READY', sub_mchid='other'");
  await assert.rejects(prepareSettlement(pool, 'order_1', now + 300), code('PAYMENT_MERCHANT_NOT_READY'));
  await pool.query("UPDATE provider_payment_merchants SET sub_mchid='test_sub'");
  await pool.execute("UPDATE order_payments SET status='PAID_REQUIRES_REVIEW', review_reason='PAYER_MISSING', payer_verification='MISSING' WHERE id=?", [payment.id]);
  await assert.rejects(prepareSettlement(pool, 'order_1', now + 300), code('PAYMENT_NOT_VERIFIED'));
  const [[row]] = await pool.query("SELECT COUNT(*) AS total FROM order_settlement_tasks");
  assert.equal(Number(row.total), 0);
});

test("settlement task insert rolls back completely if the transaction fails before commit", async () => {
  await seedAcceptedSettlement();
  const failingPool = { getConnection: async () => {
    const connection = await pool.getConnection();
    return { execute: (...args) => connection.execute(...args), beginTransaction: () => connection.beginTransaction(),
      commit: async () => { throw new Error('simulated failure before commit'); },
      rollback: () => connection.rollback(), release: () => connection.release(), destroy: () => connection.destroy() };
  } };
  await assert.rejects(prepareSettlement(failingPool, 'order_1', now + 300), /simulated failure/);
  const [[row]] = await pool.query("SELECT COUNT(*) AS total FROM order_settlement_tasks");
  assert.equal(Number(row.total), 0);
  assert.equal((await prepareSettlement(pool, 'order_1', now + 400)).status, 'PREPARED');
});

test("lost settlement commit acknowledgement recovers the committed task without changing its id", async () => {
  await seedAcceptedSettlement();
  const uncertainPool = { getConnection: async () => {
    const connection = await pool.getConnection();
    return { execute: (...args) => connection.execute(...args), beginTransaction: () => connection.beginTransaction(),
      commit: async () => { await connection.commit(); throw new Error('commit response lost'); },
      rollback: () => connection.rollback(), release: () => connection.release(), destroy: () => connection.destroy() };
  } };
  await assert.rejects(claimSettlement(uncertainPool, 'order_1', now + 300), /commit response lost/);
  const [[stored]] = await pool.query('SELECT * FROM order_settlement_tasks');
  assert.equal((await claimSettlement(pool, 'order_1', now + 301)).status, 'BUSY');
  const retry = await claimSettlement(pool, 'order_1', now + 300 + SETTLEMENT_LEASE_MS);
  assert.equal(retry.taskId, stored.id);
  assert.equal(retry.nextAction, 'QUERY');
  assert.equal(Number(stored.attempts), 1);
});

for (const useRelay of [false, true]) test(`signed settlement query reaches MySQL once and delayed processing cannot overwrite fee success (relay=${useRelay})`, async () => {
  const payment = await seedAcceptedSettlement();
  await pool.execute("UPDATE order_payments SET appid='wx_test', platform_mchid=?, sub_mchid='1900000002', transaction_id='420000000001' WHERE id=?", [queryFixture.config.platformMchid, payment.id]);
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?, sub_mchid='1900000002'", [queryFixture.config.platformMchid]);
  await pool.execute("UPDATE order_aggregates SET payload=JSON_SET(payload,'$.public.paymentTransactionId','420000000001') WHERE id='order_1'");
  const task = await prepareSettlement(pool, 'order_1', now + 300);
  const config = { ...queryFixture.config, appid: 'wx_test', settlementEnabled: true };
  function runQuery(response, time) {
    const request = queryFixture.requestFor(response);
    const runtime = useRelay ? { ...config, queryRelay: true, queryRelayInvoke: async event => ({ result: { ok: true,
      data: await require('../cloudfunctions/payment-api/query-relay').relayQuery(event, {
        enabled: true, platformMchid: config.platformMchid, merchantSerial: config.merchantSerial,
        wechatPublicKeyId: config.wechatPublicKeyId,
        merchantPublicKey: queryFixture.publicKey.export({ type: 'spki', format: 'pem' })
      }, request, () => time) } }) } : config;
    return querySettlement(pool, task.id, runtime, useRelay ? () => assert.fail('must use relay') : request, () => time);
  }
  const body = { sub_mchid: '1900000002', transaction_id: '420000000001', out_order_no: task.id,
    order_id: '300000000001', status: 'FINISHED', receivers: [{ type: 'MERCHANT_ID',
      receiver_account: config.platformMchid, amount: 100, result: 'SUCCESS', detail_id: '360000000001',
      finish_time: new Date(now + 400).toISOString() }] };
  const signed = notificationFixture.sign(JSON.stringify(body), now + 500);
  const results = await Promise.all(Array.from({ length: 20 }, () => runQuery(signed, now + 500)));
  assert.ok(results.every(item => item.status === 'FEE_SUCCEEDED'));
  assert.equal((await claimSettlement(pool, 'order_1', now + 600)).status, 'FINAL');
  body.status = 'PROCESSING'; body.receivers[0].result = 'PENDING';
  const pending = notificationFixture.sign(JSON.stringify(body), now + 600);
  assert.equal((await runQuery(pending, now + 600)).status, 'FEE_SUCCEEDED');
  const [[stored]] = await pool.execute('SELECT * FROM order_settlement_tasks WHERE id=?', [task.id]);
  const finalResult = typeof stored.channel_result === 'string' ? JSON.parse(stored.channel_result) : stored.channel_result;
  assert.equal(finalResult.finishAmountFen, null);
  assert.equal(Number(stored.verified_at), now + 500);
  await assert.rejects(recordSettlementResult(pool, task.id, { ...finalResult, status: 'CLOSED' }, now + 700), code('SETTLEMENT_RESULT_CONFLICT'));
  const forged = { ...signed, body: Buffer.concat([signed.body, Buffer.from(' ')]) };
  await assert.rejects(runQuery(forged, now + 500));
  const [[after]] = await pool.execute('SELECT status,verified_at FROM order_settlement_tasks WHERE id=?', [task.id]);
  assert.equal(after.status, 'FEE_SUCCEEDED');
  assert.equal(Number(after.verified_at), now + 500);
});

async function prepareContacting(id, timeSegments = [{ startsAt: now, endsAt: now + 3600000 }]) {
  const row = await order(id);
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  payload.public.timeSegments = timeSegments;
  payload.public.contactFirstCopiedAt = now;
  await pool.execute("UPDATE order_aggregates SET stage = 'CONTACTING', payload = ? WHERE id = ?", [JSON.stringify(payload), id]);
  return order(id);
}
function confirmOrder(id, persist = (row, next) => confirmWithSlots(pool, row, next)) {
  return handleOrder(databaseReader(), { action: "transitionOrder", orderId: id, expectedVersion: 1,
    event: "PROVIDER_ENDS_COMMUNICATION", timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, ndaRequired: false },
  { WX_OPENID: "test_provider_openid" }, contactKey, now + 1, undefined, undefined,
  persist);
}

for (const useRelay of [false, true]) test(`simultaneous provider confirmations commit only one (relay=${useRelay})`, async () => {
  await prepareContacting("order_1");
  for (let index = 2; index <= 12; index++) { await seedOrder(`slot_${index}`); await prepareContacting(`slot_${index}`); }
  const ids = ["order_1", ...Array.from({ length: 11 }, (_, index) => `slot_${index + 2}`)];
  const { confirmThroughRelay, handle } = require('../cloudfunctions/order-api/slot-relay');
  const secret = Buffer.alloc(32, 21).toString('base64');
  const persist = useRelay ? (row, next) => confirmThroughRelay(row, next, secret, async event => {
    try { return { result: await handle(event, secret, (r, n) => confirmWithSlots(pool, r, n)) }; }
    catch (error) { return { result: { ok: false, code: error.code } }; }
  }) : undefined;
  const results = await Promise.allSettled(ids.map(id => confirmOrder(id, persist)));
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(results.filter(item => item.status === "rejected").every(item => item.reason.code === "SCHEDULE_CONFLICT"));
  const [saved] = await pool.query("SELECT stage,version,payload FROM order_aggregates");
  assert.equal(saved.filter(item => item.stage === "BUYER_FINAL_CONFIRM").length, 1);
  assert.ok(saved.filter(item => item.stage === "CONTACTING").every(item => Number(item.version) === 1 && item.payload.events.length === 0));
});

test('slot confirmation succeeds with exact table privileges while account and qualification writes remain denied', async () => {
  const user = `slot_${crypto.randomBytes(6).toString('hex')}`;
  const password = crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    for (const [table, privileges] of [['accounts', 'SELECT'], ['provider_qualifications', 'SELECT'],
      ['order_aggregates', 'SELECT, UPDATE'], ['provider_slot_locks', 'SELECT, INSERT, UPDATE']]) {
      await admin.query(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    }
    restricted = mysql.createPool({ ...config, database, user, password, connectionLimit: 4 });
    await prepareContacting('order_1');
    await seedOrder('restricted_overlap'); await prepareContacting('restricted_overlap');
    const results = await Promise.allSettled(['order_1', 'restricted_overlap'].map(id =>
      confirmOrder(id, (row, next) => confirmWithSlots(restricted, row, next))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SCHEDULE_CONFLICT');
    for (const sql of ["UPDATE accounts SET nickname='blocked' WHERE id='provider'",
      "UPDATE provider_qualifications SET status='REJECTED' WHERE provider_id='provider'"]) {
      await assert.rejects(restricted.execute(sql), error => [1142, 1143].includes(error.errno));
    }
  } finally {
    if (restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});

test("adjacent segments are accepted but partial overlap with any segment is rejected", async () => {
  await prepareContacting("order_1", [{ startsAt: now, endsAt: now + 1000 }, { startsAt: now + 3000, endsAt: now + 4000 }]);
  await confirmOrder("order_1");
  await seedOrder("slot_gap");
  await prepareContacting("slot_gap", [{ startsAt: now + 1000, endsAt: now + 3000 }]);
  await confirmOrder("slot_gap");
  await seedOrder("slot_overlap");
  await prepareContacting("slot_overlap", [{ startsAt: now + 3500, endsAt: now + 4500 }]);
  await assert.rejects(confirmOrder("slot_overlap"), code("SCHEDULE_CONFLICT"));
  assert.equal((await order("slot_overlap")).stage, "CONTACTING");
});

test("confirmation retry cannot add duplicate events or advance the order twice", async () => {
  await prepareContacting("order_1");
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => confirmOrder("order_1")));
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(results.filter(item => item.status === "rejected").every(item => item.reason.code === "VERSION_CONFLICT"));
  assert.equal((await order()).payload.events.length, 1);
  assert.equal(Number((await order()).version), 2);
});

test("confirmation write failure rolls back without occupying the slot", async () => {
  const row = await prepareContacting("order_1");
  const next = { payload: JSON.stringify(row.payload), stage: "BUYER_FINAL_CONFIRM", version: 2, updated_at: now + 1 };
  await assert.rejects(confirmWithSlots(faultyPool("write"), row, next), /injected order write failure/);
  assert.equal((await order()).stage, "CONTACTING");
  assert.equal(Number((await order()).version), 1);
  await confirmOrder("order_1");
});

test("existing confirmed orders occupy slots throughout signing, payment and fulfillment", async () => {
  await seedOrder("slot_candidate");
  await prepareContacting("slot_candidate");
  for (const stage of ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"]) {
    await pool.execute("UPDATE order_aggregates SET stage = ? WHERE id = 'order_1'", [stage]);
    await assert.rejects(confirmOrder("slot_candidate"), code("SCHEDULE_CONFLICT"));
  }
  await pool.execute("UPDATE order_aggregates SET stage = 'DECLINED' WHERE id = 'order_1'");
  await confirmOrder("slot_candidate");
});

test("another provider's confirmed order does not block this provider", async () => {
  await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('slot_provider','slot_provider','TEST',1,1)");
  await seedOrder("slot_foreign", "slot_provider");
  await prepareContacting("order_1");
  await confirmOrder("order_1");
});

test("pre-communication NDA signing does not occupy the provider slot", async () => {
  const pending = await prepareContacting("order_1");
  pending.payload.public.ndaFlowVersion = 2;
  pending.payload.public.communicationDone = false;
  await pool.execute("UPDATE order_aggregates SET stage='NDA_BUYER_PENDING', payload=? WHERE id='order_1'", [JSON.stringify(pending.payload)]);
  await seedOrder("slot_after_nda"); await prepareContacting("slot_after_nda");
  await confirmOrder("slot_after_nda");
});

test("manual review requires evidence, commits one audit record and suspension blocks confirmation", async () => {
  await pool.query("UPDATE provider_qualifications SET status='PENDING',eligibility_verified=0 WHERE provider_id='provider'");
  const input = { providerId: "provider", expectedVersion: 1, career: "摄影", decision: "APPROVED", reviewedBy: "operator", note: "identity and age eligibility checked", evidenceReference: "test_review_1", eligibilityVerified: true };
  await assert.rejects(reviewQualification(pool, { ...input, eligibilityVerified: false }), code("REVIEW_INPUT_INVALID"));
  await assert.rejects(reviewQualification(pool, { ...input, career: "妆娘" }), code("REVIEW_CAREER_MISMATCH"));
  const results = await Promise.allSettled([reviewQualification(pool, input), reviewQualification(pool, input)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM provider_qualification_reviews");
  assert.equal(Number(count.total), 1);
  await prepareContacting("order_1");
  await reviewQualification(pool, { ...input, expectedVersion: 2, decision: "SUSPENDED" });
  await assert.rejects(confirmOrder("order_1"), code("PROVIDER_NOT_AVAILABLE"));
  assert.equal((await order()).stage, "CONTACTING");
});
test("different concurrent request keys cannot open multiple payments", async () => {
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reservePayment(pool, input({ requestKey: `request_distinct_${i}` }), now)));
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(outcomes.filter((r) => r.status === "rejected").every((r) => r.reason.code === "PAYMENT_ALREADY_EXISTS"));
});
test("buyer, version, confirmation, fee and merchant gates prevent records", async () => {
  await assert.rejects(reservePayment(pool, input({ buyerId: "stranger" })), code("ORDER_NOT_FOUND"));
  await assert.rejects(reservePayment(pool, input({ expectedVersion: 2 })), code("VERSION_CONFLICT"));
  await assert.rejects(reservePayment(pool, input({ fee: null })), code("PAYMENT_FEE_NOT_CONFIGURED"));
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.amountConfirmed', false)");
  await assert.rejects(reservePayment(pool, input()), code("AGREEMENT_NOT_CONFIRMED"));
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.amountConfirmed', true)");
  await pool.query("UPDATE provider_payment_merchants SET status='PENDING'");
  await assert.rejects(reservePayment(pool, input()), code("PAYMENT_MERCHANT_NOT_READY"));
  assert.equal((await payments()).length, 0);
});
test("20 duplicate notifications update order and event exactly once", async () => {
  const p = await reservePayment(pool, input(), now);
  const receipts = await Promise.all(Array.from({ length: 20 }, () => recordPaymentSuccess(pool, result(p), now + 200)));
  assert.equal(receipts.filter((r) => !r.duplicate).length, 1);
  const saved = await order();
  assert.equal(saved.version, 2);
  assert.equal(saved.payload.public.paymentStatus, "PAID");
  assert.equal(saved.payload.events.length, 1);
  assert.equal(saved.stage, "BUYER_FINAL_CONFIRM");
  assert.equal(Number((await payments())[0].payer_paid_fen), 9800);
});
test("identity mismatches never mutate payment or order", async () => {
  const p = await reservePayment(pool, input(), now);
  for (const field of ["combineOutTradeNo", "appid", "platformMchid", "subMchid", "payerOpenid"]) {
    await assert.rejects(recordPaymentSuccess(pool, result(p, { [field]: "wrong" })), code("PAYMENT_RESULT_MISMATCH"));
  }
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).version, 1);
});
test("actual money with unexpected amount is retained for review", async () => {
  const p = await reservePayment(pool, input(), now);
  assert.equal((await recordPaymentSuccess(pool, result(p, { totalFen: 12000 }))).status, "PAID_REQUIRES_REVIEW");
  assert.equal(Number((await payments())[0].received_total_fen), 12000);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});
test("changed agreement cannot start execution from old payment", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.location', 'changed')");
  assert.equal((await recordPaymentSuccess(pool, result(p))).status, "PAID_REQUIRES_REVIEW");
  assert.equal((await payments())[0].review_reason, "AGREEMENT_OR_STAGE_CHANGED");
});
function faultyPool(fault) {
  return { async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, key) {
      if (key === "execute" && fault === "write") return async (sql, args) => {
        if (sql.startsWith("UPDATE order_aggregates")) throw new Error("injected order write failure");
        return target.execute(sql, args);
      };
      if (key === "commit" && fault === "ack") return async () => { await target.commit(); throw new Error("injected commit acknowledgement loss"); };
      return typeof target[key] === "function" ? target[key].bind(target) : target[key];
    } });
  } };
}
test("order write failure rolls back actual receipt write in MySQL", async () => {
  const p = await reservePayment(pool, input(), now);
  await assert.rejects(recordPaymentSuccess(faultyPool("write"), result(p)), /injected order write failure/);
  const row = (await payments())[0];
  assert.equal(row.status, "CREATED"); assert.equal(row.transaction_id, null);
  assert.equal((await order()).version, 1);
  assert.equal((await recordPaymentSuccess(pool, result(p))).status, "PAID");
});
test("lost commit acknowledgement recovers through idempotent retry", async () => {
  const p = await reservePayment(pool, input(), now);
  await assert.rejects(recordPaymentSuccess(faultyPool("ack"), result(p)), /acknowledgement loss/);
  assert.equal((await recordPaymentSuccess(pool, result(p))).duplicate, true);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});
test("close and success race never loses a receipt or reverses paid state", async () => {
  const p = await reservePayment(pool, input(), now);
  await Promise.all([recordPaymentClosed(pool, result(p, { tradeState: "CLOSED" })), recordPaymentSuccess(pool, result(p))]);
  const saved = (await payments())[0];
  assert.ok(["PAID", "PAID_REQUIRES_REVIEW"].includes(saved.status));
  assert.equal(saved.transaction_id, result(p).transactionId);
  assert.equal((await recordPaymentClosed(pool, result(p, { tradeState: "CLOSED" }))).status, saved.status);
});
test("late success on closed attempt prevents automatic confirmation of another receipt", async () => {
  const old = await reservePayment(pool, input(), now);
  await recordPaymentClosed(pool, result(old, { tradeState: "CLOSED" }));
  const next = await reservePayment(pool, input({ requestKey: "request_0000000002", expectedVersion: (await order()).version }), now + 1);
  await recordPaymentSuccess(pool, result(old));
  assert.equal((await recordPaymentSuccess(pool, result(next))).status, "PAID_REQUIRES_REVIEW");
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});
test("database rejects a channel transaction reused across two orders", async () => {
  const p = await reservePayment(pool, input(), now);
  await recordPaymentSuccess(pool, result(p));
  await seedOrder("order_2");
  const second = await reservePayment(pool, input({ orderId: "order_2" }), now);
  await assert.rejects(recordPaymentSuccess(pool, result(second, { transactionId: result(p).transactionId })), code("ER_DUP_ENTRY"));
  assert.equal((await order("order_2")).version, 1);
});
test("database rejects fake paid state with no receipt", async () => {
  await reservePayment(pool, input(), now);
  await assert.rejects(pool.query("UPDATE order_payments SET status='PAID'"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
});

// Read-only CloudBase query shape backed by the real local database, not an in-memory order fixture.
function databaseReader() {
  return { from(table) {
    assert.ok(["accounts", "wechat_identities", "account_roles", "order_aggregates", "order_payments", "provider_payment_merchants", "provider_qualifications", "provider_catalog_publications", "order_funds_interlocks", "media_assets"].includes(table));
    const filters = [], values = [], sorting = [];
    let limit = "", join = false, update = null;
    const columnName = (column) => {
      assert.match(column, /^(order_aggregates\.)?[a-z_]+$/);
      return column.includes(".") ? `o.\`${column.split(".")[1]}\`` : `t.\`${column}\``;
    };
    return { select(fields = "") { join = fields.includes("!inner"); return this; },
      update(next) {
        assert.equal(table, 'order_aggregates');
        assert.deepEqual(Object.keys(next).sort(), ['payload','stage','updated_at','version']);
        update = next;
        return this;
      },
      eq(column, value) { filters.push(`${columnName(column)} = ?`); values.push(value); return this; },
      lt(column, value) { filters.push(`${columnName(column)} < ?`); values.push(value); return this; },
      in(column, expected) { filters.push(`${columnName(column)} IN (${expected.map(() => "?").join(",")})`); values.push(...expected); return this; },
      order(column, options) { sorting.push(`${columnName(column)} ${options.ascending ? "ASC" : "DESC"}`); return this; },
      limit(value) { assert.ok(Number.isInteger(value) && value > 0 && value <= 21); limit = ` LIMIT ${value}`; return this; },
      then(resolve, reject) {
        if (update) return pool.execute(`UPDATE order_aggregates t SET payload=?, stage=?, updated_at=?, version=? WHERE ${filters.join(' AND ')}`,
          [update.payload, update.stage, update.updated_at, update.version, ...values])
          .then(([result]) => ({ data: result.affectedRows ? [{ id: values[0] }] : [], error: null })).then(resolve, reject);
        return pool.execute(`SELECT t.*${join ? ", o.provider_id AS joined_provider_id" : ""} FROM \`${table}\` t${join ? " INNER JOIN order_aggregates o ON o.id = t.order_id" : ""} WHERE ${filters.join(" AND ")}${sorting.length ? ` ORDER BY ${sorting.join(",")}` : ""}${limit}`,
          values).then(([data]) => ({ data: join ? data.map((row) => ({ ...row, order_aggregates: { provider_id: row.joined_provider_id } })) : data, error: null })).then(resolve, reject);
      }
    };
  } };
}
for (const scenario of ['identical', 'conflicting', 'lost-response']) test(`real order creation recovers ${scenario} concurrent inserts`, { timeout: 15000 }, async () => {
  const catalog = { profile: { career: '摄影', city: '杭州', cityCode: '330100' },
    services: [{ id: 'service_1', name: '摄影', unit: '套', priceFen: 68000, serviceMode: 'ONSITE', serviceAreas: [] }], works: [] };
  await pool.execute(`INSERT INTO provider_catalog_publications(provider_id,payload,draft_version,publication_version,published_at,updated_at)
    VALUES('provider',?,1,1,1,1) ON DUPLICATE KEY UPDATE payload=VALUES(payload)`, [JSON.stringify(catalog)]);
  const count = scenario === 'lost-response' ? 1 : 12;
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const reader = databaseReader();
  const db = { from(table) {
    const builder = reader.from(table);
    if (table === 'order_aggregates') builder.insert = async row => {
      if (++arrivals === count) release();
      await barrier;
      await pool.execute(`INSERT INTO order_aggregates(id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [row.id,row.buyer_id,row.provider_id,row.request_idempotency_key,row.request_hash,row.stage,row.payload,row.version,row.created_at,row.updated_at]);
      if (scenario === 'lost-response') throw Error('SYNTHETIC_COMMIT_RESPONSE_LOST');
      return { data: [row] };
    };
    return builder;
  } };
  const event = { action: 'createOrder', providerId: 'provider', serviceIds: ['service_1'], city: '杭州', cityCode: '330100',
    requirement: '用于并发测试的合成摄影需求', timeSegments: [{ startsAt: now + 10000, endsAt: now + 20000 }],
    contact: { name: 'TEST', wechat: 'test_only', phone: '' }, ndaRequired: false, idempotencyKey: 'concurrent_order_key_0001' };
  try {
    const results = await Promise.allSettled(Array.from({ length: count }, (_, i) => handleOrder(db,
      { ...event, requirement: scenario === 'conflicting' ? event.requirement + i : event.requirement },
      { WX_OPENID: 'test_openid' }, contactKey, now, crypto.randomUUID)));
    const successes = results.filter(r => r.status === 'fulfilled');
    assert.equal(arrivals, count);
    assert.equal(successes.length, scenario === 'conflicting' ? 1 : count);
    assert.equal(new Set(successes.map(r => r.value.id)).size, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'IDEMPOTENCY_CONFLICT'));
    const [[stored]] = await pool.execute('SELECT COUNT(*) AS n FROM order_aggregates WHERE buyer_id=? AND request_idempotency_key=?', ['buyer',event.idempotencyKey]);
    assert.equal(Number(stored.n), 1);
    if (scenario !== 'conflicting') {
      const recovered = await handleOrder(db, event, { WX_OPENID: 'test_openid' }, contactKey, now + 30000, crypto.randomUUID);
      assert.equal(recovered.id, successes[0].value.id);
      await assert.rejects(handleOrder(db, { ...event, idempotencyKey: 'expired_new_order_key_0001' },
        { WX_OPENID: 'test_openid' }, contactKey, now + 30000, crypto.randomUUID), code('INVALID_TIME_SEGMENTS'));
      assert.equal(arrivals, count);
    }
  } finally {
    release();
    await pool.execute("DELETE FROM provider_catalog_publications WHERE provider_id='provider'");
  }
});

test("verified notification and outgoing query reach database and actual buyer/provider payment states", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p, { totalFen: 12000 })), now + 200);
  await withNotificationHttp(pool, async (url) => {
    const response = await fetch(url, { method: "POST", headers: request.headers, body: request.body });
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
  });
  await seedOrder("order_2");
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid = ? WHERE provider_id = 'provider'", [queryFixture.config.platformMchid]);
  const normal = await reservePayment(pool, input({ orderId: "order_2", platformMchid: queryFixture.config.platformMchid }), now);
  const normalResponse = notificationFixture.sign(JSON.stringify(notificationFixture.transaction(result(normal))), now + 200);
  await queryPayment(pool, normal.id, queryFixture.config, queryFixture.requestFor(normalResponse), () => now + 200);
  await seedOrder("order_3");
  const closed = await reservePayment(pool, input({ orderId: "order_3", platformMchid: queryFixture.config.platformMchid }), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING') WHERE id = 'order_3'");
  await queryPayment(pool, closed.id, queryFixture.config, queryFixture.requestFor(queryResult(closed, "CLOSED")), () => now + 200);
  await seedOrder("order_4");
  const missing = await reservePayment(pool, input({ orderId: "order_4", platformMchid: queryFixture.config.platformMchid }), now);
  const missingData = notificationFixture.transaction(result(missing)); delete missingData.combine_payer_info;
  const missingResponse = notificationFixture.sign(JSON.stringify(missingData), now + 200);
  await queryPayment(pool, missing.id, queryFixture.config, queryFixture.requestFor(missingResponse), () => now + 200);
  for (const [openId, role, pageName] of [["test_openid", "BUYER", "booking-status"], ["test_provider_openid", "PROVIDER", "provider-request"]]) {
    const response = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_1" }, { WX_OPENID: openId }, contactKey);
    assert.equal(response.viewerRole, role);
    assert.equal(response.paymentStatus, "PAYMENT_REVIEW");
    const client = toClientOrder(response);
    let definition;
    global.Page = (value) => { definition = value; };
    require(`../miniprogram/pages/${pageName}/index`);
    delete global.Page;
    const page = { cloudMode: true, data: structuredClone(definition.data) };
    for (const [key, value] of Object.entries(definition)) if (typeof value === "function") page[key] = value.bind(page);
    page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
    page.renderOrder(client);
    assert.equal(page.data.order.paymentStatus, "PAYMENT_REVIEW");
    if (role === "BUYER") assert.match(page.data.paymentHint, /请勿重复付款/);
    else assert.equal(page.data.isWaitingBuyerConfirm, true);
    const missingOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_4" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(missingOrder));
    assert.equal(page.data.order.paymentStatus, "PAYMENT_REVIEW");
    if (role === "BUYER") { assert.match(page.data.paymentHint, /付款信息或订单状态需要核对/); await page.startPayment(); }
    const paidOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_2" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(paidOrder));
    assert.equal(page.data.order.paymentStatus, "PAID");
    if (role === "BUYER") { assert.match(page.data.paymentHint, /付款已确认/); await page.startPayment(); }
    const unpaidOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_3" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(unpaidOrder));
    assert.equal(page.data.order.paymentStatus, "UNPAID");
    if (role === "BUYER") { assert.equal(page.data.agreementConfirmed, true); assert.match(page.data.paymentHint, /继续付款/); }
    else assert.equal(page.data.isWaitingBuyerConfirm, true);
  }
  await assert.rejects(handleOrder(databaseReader(), { action: "transitionOrder", orderId: "order_1", expectedVersion: 2, event: "BUYER_CONFIRMS_EXECUTION" },
    { WX_OPENID: "test_openid" }, contactKey), code("PAYMENT_NOT_VERIFIED"));
  await assert.rejects(handleOrder(databaseReader(), { action: "transitionOrder", orderId: "order_4", expectedVersion: 2, event: "BUYER_CONFIRMS_EXECUTION" },
    { WX_OPENID: "test_openid" }, contactKey), code("PAYMENT_NOT_VERIFIED"));
});

test("real HTTP acknowledgement distinguishes invalid notification, lost commit reply and durable retry", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p)), now + 200, { summary: "支付成功" });
  await withNotificationHttp(pool, async (url) => {
    assert.equal((await fetch(url)).status, 405);
    const invalid = await fetch(url, { method: "POST", headers: request.headers, body: Buffer.concat([request.body, Buffer.from(" ")]) });
    assert.equal(invalid.status, 403); assert.equal((await invalid.json()).code, "FAIL");
  });
  assert.equal((await payments())[0].transaction_id, null);
  await withNotificationHttp(faultyPool("ack"), async (url) => {
    const uncertain = await fetch(url, { method: "POST", headers: request.headers, body: request.body });
    assert.equal(uncertain.status, 500);
    const body = await uncertain.text();
    assert.equal(body.includes("acknowledgement"), false); assert.equal(body.includes(p.id), false);
  });
  assert.equal((await order()).payload.public.paymentStatus, "PAID");
  await withNotificationHttp(pool, async (url) => {
    const retry = await fetch(url, { method: "POST", headers: request.headers, body: request.body });
    assert.equal(retry.status, 204); assert.equal(await retry.text(), "");
    assert.equal(retry.headers.get("cache-control"), "no-store");
  });
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});

test("query missing payer preserves money for review once without inventing identity or auto-releasing review", async () => {
  const p = await reservePayment(pool, input({ fee: { version: 'PLATFORM_20_PERCENT_V1', amountFen: 2000 } }), now);
  const data = notificationFixture.transaction(result(p)); delete data.combine_payer_info;
  const response = notificationFixture.sign(JSON.stringify(data), now + 200);
  await assert.rejects(acceptPaymentQuery(faultyPool("write"), response, notificationFixture.config, p.id, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].payer_verification, null);
  const read = () => acceptPaymentQuery(pool, response, notificationFixture.config, p.id, now + 200);
  const outcomes = await Promise.all(Array.from({ length: 10 }, read));
  assert.equal(outcomes.filter((item) => !item.duplicate).length, 1);
  const saved = (await payments())[0];
  assert.equal(saved.payer_verification, "MISSING");
  assert.equal(saved.payer_openid, "test_openid"); // Original reservation remains expected identity, never a claimed returned payer.
  assert.equal(saved.review_reason, "PAYER_NOT_RETURNED");
  assert.equal(Number(saved.received_total_fen), 10000);
  assert.equal(Number(saved.payer_paid_fen), 9800);
  assert.equal(saved.status, "PAID_REQUIRES_REVIEW");
  await acceptPaymentNotification(pool, notificationFixture.notify(notificationFixture.transaction(result(p)), now + 300), notificationFixture.config, now + 300);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
  assert.equal((await payments())[0].payer_verification, "MISSING");
  const funds = await handleOrder(databaseReader(), { action: "getProviderFunds" }, { WX_OPENID: "test_provider_openid" }, contactKey);
  assert.equal(funds.records[0].status, "PAID_REQUIRES_REVIEW");
  assert.equal(JSON.stringify(funds).includes("test_openid"), false);
});

test("later missing-payer query cannot downgrade paid receipt and missing identity cannot be marked verified", async () => {
  const p = await reservePayment(pool, input(), now);
  await recordPaymentSuccess(pool, result(p), now + 200);
  const data = notificationFixture.transaction(result(p)); delete data.combine_payer_info;
  await acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(data), now + 200), notificationFixture.config, p.id, now + 200);
  assert.equal((await payments())[0].payer_verification, "MATCHED");
  assert.equal((await payments())[0].status, "PAID");
  await assert.rejects(pool.query("UPDATE order_payments SET payer_verification = 'MISSING'"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
  await assert.rejects(pool.query("UPDATE order_payments SET payer_verification = NULL"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
  await assert.rejects(recordPaymentSuccess(pool, result(p, { payerOpenid: undefined }), now + 200), code("PAYMENT_RESULT_INVALID"));
  const wrong = notificationFixture.transaction(result(p, { payerOpenid: "wrong" }));
  await assert.rejects(acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(wrong), now + 200), notificationFixture.config, p.id, now + 200), code("PAYMENT_RESULT_MISMATCH"));
});

test("unpaid observations never downgrade a received payment and present payer must match", async () => {
  const p = await reservePayment(pool, input(), now);
  const read = (state) => acceptPaymentQuery(pool, queryResult(p, state), notificationFixture.config, p.id, now + 200);
  assert.deepEqual(await read("NOTPAY"), { status: "CREATED", channelStatus: "NOTPAY" });
  assert.deepEqual(await read("PAYERROR"), { status: "CREATED", channelStatus: "PAYERROR" });
  assert.equal((await order()).version, 1);
  await recordPaymentSuccess(pool, result(p), now + 200);
  for (const state of ["NOTPAY", "PAYERROR", "CLOSED"]) assert.equal((await read(state)).status, "PAID");
  assert.equal((await order()).payload.public.paymentStatus, "PAID");
  assert.equal((await order()).version, 2);
  const wrong = JSON.parse(queryResult(p, "CLOSED").body); wrong.combine_payer_info = { openid: "wrong" };
  await assert.rejects(acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(wrong), now + 200), notificationFixture.config, p.id, now + 200), code("PAYMENT_RESULT_MISMATCH"));
});

test("closed active payment restores unpaid once; an old close cannot clear a newer pending payment", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  const closed = queryResult(p, "CLOSED");
  const close = () => acceptPaymentQuery(pool, closed, notificationFixture.config, p.id, now + 200);
  await close(); await close();
  assert.equal((await order()).payload.public.paymentStatus, "UNPAID");
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
  const next = await reservePayment(pool, input({ expectedVersion: 2, requestKey: "request_after_closed" }), now + 200);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  await close();
  assert.equal((await order()).payload.public.paymentStatus, "VERIFYING");
  assert.equal((await order()).version, 2);
  await recordPaymentSuccess(pool, result(p), now + 300);
  await acceptPaymentQuery(pool, queryResult(next, "CLOSED"), notificationFixture.config, next.id, now + 300);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});

test("failure restoring an order after verified close rolls back the payment close too", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  await assert.rejects(acceptPaymentQuery(faultyPool("write"), queryResult(p, "CLOSED"), notificationFixture.config, p.id, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).payload.public.paymentStatus, "VERIFYING");
  assert.equal((await order()).version, 1);
});

test('verified close advances unpaid order version once so stable client keys can retry', async () => {
  const firstInput=input({requestKey:'payment-order_1-version-1'});
  const first=await reservePayment(pool,firstInput,now);
  await Promise.all(Array.from({length:10},()=>acceptPaymentQuery(pool,queryResult(first,'CLOSED'),notificationFixture.config,first.id,now+100)));
  assert.equal((await order()).version,2);
  assert.equal((await order()).payload.events.filter(e=>e.event==='PAYMENT_ATTEMPT_CLOSED').length,1);
  assert.equal((await reservePayment(pool,firstInput,now+200)).status,'CLOSED');
  const attempts=await Promise.all(Array.from({length:10},()=>reservePayment(pool,input({expectedVersion:2,requestKey:'payment-order_1-version-2'}),now+200)));
  assert.equal(new Set(attempts.map(p=>p.id)).size,1);
  assert.notEqual(attempts[0].id,first.id);
  assert.equal((await payments()).length,2);
});

test('late receipt on old closed attempt prevents already reserved new attempt reaching cashier', async () => {
  const {preparePaymentSession}=require('../cloudfunctions/payment-api/prepay-session');
  const config={...queryFixture.config,appid:'test_app',prepayEnabled:true,notifyUrl:'https://example.test/payment'};
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'",[config.platformMchid]);
  const first=await reservePayment(pool,input({platformMchid:config.platformMchid}),now);
  await recordPaymentClosed(pool,result(first,{tradeState:'CLOSED'}),now+100);
  const next=await reservePayment(pool,input({platformMchid:config.platformMchid,expectedVersion:2,requestKey:'payment-order_1-version-2'}),now+200);
  await recordPaymentSuccess(pool,result(first),now+300);
  await assert.rejects(preparePaymentSession(pool,next.id,config,()=>assert.fail('must not open another payment'),()=>now+400),code('PAYMENT_STATE_CHANGED'));
  assert.equal((await order()).payload.public.paymentStatus,'PAYMENT_REVIEW');
});

test("failed outgoing query preserves the order and payment; verified retry recovers once", async () => {
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid = ? WHERE provider_id = 'provider'", [queryFixture.config.platformMchid]);
  const p = await reservePayment(pool, input({ platformMchid: queryFixture.config.platformMchid }), now);
  const response = notificationFixture.sign(JSON.stringify(notificationFixture.transaction(result(p))), now + 200);
  for (const statusCode of [302, 404, 500]) {
    await assert.rejects(queryPayment(pool, p.id, queryFixture.config, queryFixture.requestFor({ ...response, statusCode }), () => now + 200), code("PAYMENT_QUERY_FAILED"));
  }
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).version, 1);
  assert.equal((await order()).payload.public.paymentStatus, "UNPAID");
  const recover = () => queryPayment(pool, p.id, queryFixture.config, queryFixture.requestFor(response), () => now + 200);
  const outcomes = await Promise.all(Array.from({ length: 10 }, recover));
  assert.equal(outcomes.filter((item) => !item.duplicate).length, 1);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});

test("20 signed notification retries acknowledge only one committed receipt", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p)), now + 200);
  const responses = await Promise.all(Array.from({ length: 20 }, () => acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)));
  assert.ok(responses.every((response) => response.statusCode === 204 && response.body === ""));
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});

test("invalid signature never writes, failed commit path can recover from a signed query", async () => {
  const p = await reservePayment(pool, input(), now);
  const transaction = notificationFixture.transaction(result(p));
  const request = notificationFixture.notify(transaction, now + 200);
  await assert.rejects(acceptPaymentNotification(pool, { ...request, body: Buffer.concat([request.body, Buffer.from(" ")]) }, notificationFixture.config, now + 200), code("PAYMENT_SIGNATURE_INVALID"));
  await assert.rejects(acceptPaymentNotification(faultyPool("write"), request, notificationFixture.config, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].transaction_id, null);
  assert.equal((await order()).version, 1);
  const query = notificationFixture.sign(JSON.stringify(transaction), now + 200);
  assert.equal((await acceptPaymentQuery(pool, query, notificationFixture.config, p.id, now + 200)).status, "PAID");
  assert.equal((await acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)).statusCode, 204);
  assert.equal((await order()).payload.events.length, 1);
});

test("notification commit acknowledgement loss is not falsely acknowledged and retry is safe", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p)), now + 200);
  await assert.rejects(acceptPaymentNotification(faultyPool("ack"), request, notificationFixture.config, now + 200), /acknowledgement loss/);
  assert.equal((await acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)).statusCode, 204);
  assert.equal((await order()).version, 2);
});

test("real receipts paginate through provider-only funds API and actual funds page", async () => {
  await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('other_provider','other_provider','TEST',1,1)");
  await pool.query("INSERT INTO provider_payment_merchants VALUES ('other_provider','test_platform','test_other_sub','READY',1)");
  await seedOrder("foreign_order", "other_provider");
  const foreign = await reservePayment(pool, input({ orderId: "foreign_order", fee: { version: 'PLATFORM_20_PERCENT_V1', amountFen: 2000 } }), now);
  await recordPaymentSuccess(pool, result(foreign));
  for (let i = 0; i < 23; i++) {
    const orderId = i === 0 ? "order_1" : `funds_order_${i}`;
    if (i) await seedOrder(orderId);
    const p = await reservePayment(pool, input({ orderId, fee: { version: 'PLATFORM_20_PERCENT_V1', amountFen: 2000 } }), now);
    await recordPaymentSuccess(pool, result(p, i === 22 ? { totalFen: 12000 } : {}));
  }
  const call = (cursor = null) => handleOrder(databaseReader(), { action: "getProviderFunds", providerId: "stranger", cursor }, { WX_OPENID: "test_provider_openid" }, contactKey);
  const first = await call();
  const second = await call(first.nextCursor);
  assert.equal(first.records.length, 20); assert.equal(second.records.length, 3);
  assert.equal(new Set([...first.records, ...second.records].map((r) => r.id)).size, 23);
  assert.equal(second.nextCursor, null);
  assert.equal(first.withdrawableBalanceFen, null);
  assert.equal(JSON.stringify(first).includes("test_openid"), false);
  assert.equal(JSON.stringify(first).includes("transaction_id"), false);
  await assert.rejects(handleOrder(databaseReader(), { action: "getProviderFunds" }, { WX_OPENID: "test_openid" }, contactKey), code("PROVIDER_ROLE_REQUIRED"));
  let definition;
  global.Page = (value) => { definition = value; };
  require("../miniprogram/pages/funds/index");
  delete global.Page;
  const page = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  definition.renderResponse.call(page, first, false);
  definition.renderResponse.call(page, second, true);
  assert.equal(page.data.records.length, 23);
  assert.ok(page.data.records.some((r) => r.statusText === "付款待核对"));
});

const { refreshPayment, COOLDOWN_MS, LEASE_MS } = require('../cloudfunctions/payment-api/payment-refresh');
const refreshEvent = { action:'refreshPayment', orderId:'order_1' };
const refreshCaller = { WX_OPENID:'test_openid', WX_APPID:'test_app' };
test('public refresh rejects foreign orders, provider identity and payment identity before external query', async () => {
  const p = await reservePayment(pool, input(), now);
  let calls = 0;
  const query = async () => { calls++; };
  await assert.rejects(refreshPayment(pool, refreshEvent, {WX_OPENID:'test_provider_openid',WX_APPID:'test_app'}, {}, query, () => now), code('ACCOUNT_NOT_FOUND'));
  await assert.rejects(refreshPayment(pool, refreshEvent, {...refreshCaller,WX_APPID:'foreign_app'}, {}, query, () => now), code('PAYMENT_IDENTITY_MISMATCH'));
  await pool.query("UPDATE order_aggregates SET buyer_id = 'provider' WHERE id = 'order_1'");
  await assert.rejects(refreshPayment(pool, refreshEvent, refreshCaller, {}, query, () => now), code('ORDER_NOT_FOUND'));
  assert.equal(calls, 0);
  assert.equal(Number((await payments())[0].query_started_at), 0);
});
test('public refresh shares one query across concurrent instances and keeps failure cooldown', async () => {
  await reservePayment(pool, input(), now);
  let calls = 0;
  const query = async () => { calls++; throw Object.assign(new Error('timeout'), {code:'PAYMENT_QUERY_TIMEOUT'}); };
  const outcomes = await Promise.allSettled(Array.from({length:12}, () => refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now)));
  assert.equal(calls, 1);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled' && item.value.queryStatus === 'THROTTLED').length,11);
  assert.equal((await payments())[0].query_lease_token, null);
  assert.equal((await refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now+COOLDOWN_MS-1)).queryStatus,'THROTTLED');
  await assert.rejects(refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now+COOLDOWN_MS), code('PAYMENT_QUERY_TIMEOUT'));
  assert.equal(calls,2);
  assert.equal((await order()).payload.public.paymentStatus,'UNPAID');
});
test('expired refresh lease recovers and late completion cannot release its successor', async () => {
  await reservePayment(pool,input(),now);
  const releases = [], starts = [];
  let notify;
  const started = () => new Promise(resolve => { notify = resolve; });
  const query = () => new Promise(resolve => { releases.push(resolve); starts.push(true); if(notify) notify(); });
  const firstStarted = started();
  const first = refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now);
  await firstStarted;
  const secondStarted = started();
  const second = refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now+LEASE_MS+1);
  await secondStarted;
  const secondToken = (await payments())[0].query_lease_token;
  releases[0](); await first;
  assert.equal((await payments())[0].query_lease_token,secondToken);
  releases[1](); await second;
  assert.equal((await payments())[0].query_lease_token,null);
  assert.equal(starts.length,2);
});
test('public refresh without a payment or with a receipt does not call the channel', async () => {
  let calls = 0; const query = async () => { calls++; };
  assert.equal((await refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now)).queryStatus,'NOT_STARTED');
  const p = await reservePayment(pool,input(),now);
  await recordPaymentSuccess(pool,result(p));
  assert.equal((await refreshPayment(pool,refreshEvent,refreshCaller,{},query,()=>now)).queryStatus,'FINAL');
  assert.equal(calls,0);
});
test('buyer refresh action reaches signed query, MySQL, existing order API and both actual pages', async t => {
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid = ? WHERE provider_id = 'provider'",[queryFixture.config.platformMchid]);
  const p = await reservePayment(pool,input({platformMchid:queryFixture.config.platformMchid}),now);
  const signed = notificationFixture.sign(JSON.stringify(notificationFixture.transaction(result(p))),now+200);
  const query = (db,id,config) => queryPayment(db,id,config,queryFixture.requestFor(signed),()=>now+200);
  const service = require('../miniprogram/services/cloud-orders');
  t.mock.method(service,'refreshPayment', id => refreshPayment(pool,{action:'refreshPayment',orderId:id},refreshCaller,queryFixture.config,query,()=>now+200));
  const readFor = async openid => toClientOrder(await handleOrder(databaseReader(),{action:'getOrder',orderId:'order_1'},{WX_OPENID:openid},contactKey));
  t.mock.method(service,'getOrder',() => readFor('test_openid'));
  function pageFor(route) {
    let definition; global.Page = value => { definition=value; };
    const filename=require.resolve(`../miniprogram/pages/${route}/index`);delete require.cache[filename];require(filename);delete global.Page;
    const page={...definition,cloudMode:true,orderId:'order_1',data:structuredClone(definition.data)};
    page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback();};return page;
  }
  const buyer=pageFor('booking-status');buyer.renderOrder(await readFor('test_openid'));
  await buyer.refreshCloudPayment();
  assert.equal(buyer.data.paymentStatus,'PAID');assert.match(buyer.data.paymentHint,/付款已确认/);
  const provider=pageFor('provider-request');provider.renderOrder(await readFor('test_provider_openid'));
  assert.equal(provider.data.order.paymentStatus,'PAID');
  assert.equal((await order()).version,2);
  assert.equal((await payments())[0].query_lease_token,null);
});

for (const useRelay of [false, true]) test(`prepay database locks prevent concurrent submissions (relay=${useRelay})`, async () => {
  const { preparePaymentSession } = require("../cloudfunctions/payment-api/prepay-session");
  const config = { ...queryFixture.config, appid: "test_app", prepayEnabled: true, notifyUrl: "https://example.test/payment" };
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'", [config.platformMchid]);
  const payment = await reservePayment(pool, input({ platformMchid: config.platformMchid }), now);
  let submits = 0;
  const channel = useRelay ? undefined : async () => { submits++; return { prepayId: "wx_database", paymentRequest: { package: "prepay_id=wx_database" } }; };
  if (useRelay) {
    const { relayMutation } = require('../cloudfunctions/payment-api/mutation-relay');
    const relayConfig = { ...config, enabled: true, mutationsEnabled: true,
      merchantPublicKey: queryFixture.publicKey.export({ type: 'spki', format: 'pem' }) };
    const response = notificationFixture.sign(JSON.stringify({ prepay_id: 'wx_database' }), now + 100);
    config.mutationRelay = true;
    config.mutationRelayInvoke = async event => ({ result: { ok: true,
      data: await relayMutation(event, relayConfig, queryFixture.requestFor(response, () => { submits++; }), () => now + 100, e => require('../cloudfunctions/payment-api/mutation-replay-guard').consumeMutation(pool, e, relayConfig, () => now + 100)) } });
  }
  const results = await Promise.all(Array.from({ length: 12 }, () => preparePaymentSession(pool, payment.id, config, channel, () => now + 100)));
  assert.equal(submits, 1);
  assert.ok(results.every(result => ["READY", "BUSY"].includes(result.status)));
  const [[saved]] = await pool.execute("SELECT prepay_id,prepay_lease_token FROM order_payments WHERE id=?", [payment.id]);
  assert.equal(saved.prepay_id, "wx_database");
  assert.equal(saved.prepay_lease_token, null);
});

for (const scenario of ['expired', 'replaced']) test(`prepay ownership guard handles ${scenario} commits in real MySQL`, async () => {
  const { preparePaymentSession } = require('../cloudfunctions/payment-api/prepay-session');
  const config = { ...queryFixture.config, appid: 'test_app', prepayEnabled: true, notifyUrl: 'https://example.test/payment' };
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'", [config.platformMchid]);
  const payment = await reservePayment(pool, input({ platformMchid: config.platformMchid }), now);
  let currentTime = now + 100, altered = false, calls = 0;
  const successor = 'f'.repeat(32);
  const wrapped = { execute: (...args) => pool.execute(...args), async getConnection() {
    const connection = await pool.getConnection();
    return { execute: (...args) => connection.execute(...args), beginTransaction: () => connection.beginTransaction(),
      rollback: () => connection.rollback(), release: () => connection.release(), destroy: () => connection.destroy(),
      async commit() {
        await connection.commit();
        if (altered) return;
        altered = true;
        if (scenario === 'expired') currentTime += 31000;
        else await pool.execute('UPDATE order_payments SET prepay_lease_token=? WHERE id=?', [successor, payment.id]);
      } };
  } };
  const channel = async row => { calls++; assert.equal(row.id, payment.id); return { prepayId: 'wx_guarded', paymentRequest: {} }; };
  const first = await preparePaymentSession(wrapped, payment.id, config, channel, () => currentTime);
  assert.equal(calls, 0);
  const saved = (await payments())[0];
  if (scenario === 'expired') {
    assert.equal(first.status, 'BUSY'); assert.equal(Number(saved.prepay_started_at), 0);
    assert.equal((await preparePaymentSession(pool, payment.id, config, channel, () => currentTime)).status, 'READY');
    assert.equal(calls, 1); assert.equal((await payments()).length, 1);
  } else {
    assert.equal(first.status, 'QUERY_REQUIRED'); assert.equal(saved.prepay_lease_token, successor);
    assert.equal(Number(saved.prepay_started_at), now + 100);
  }
});

for (const useRelay of [false, true]) test(`prepay timeout survives database reload without resubmission (relay=${useRelay})`, async () => {
  const { preparePaymentSession } = require("../cloudfunctions/payment-api/prepay-session");
  const config = { ...queryFixture.config, appid: "test_app", prepayEnabled: true, notifyUrl: "https://example.test/payment" };
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'", [config.platformMchid]);
  const payment = await reservePayment(pool, input({ platformMchid: config.platformMchid }), now);
  let submits = 0;
  const channel = useRelay ? undefined : async () => { submits++; throw new Error("simulated transport timeout"); };
  if (useRelay) {
    config.mutationRelay = true;
    config.mutationRelayInvoke = async () => { submits++; throw new Error('simulated bridge timeout'); };
  }
  await assert.rejects(preparePaymentSession(pool, payment.id, config, channel, () => now + 100));
  const next = await preparePaymentSession(pool, payment.id, config, channel, () => now + 40000);
  assert.equal(next.status, "QUERY_REQUIRED");
  assert.equal(submits, 1);
});

test("confirmed 20 percent is calculated from locked order amount and persisted immutably", async () => {
  const { VERSION } = require("../cloudfunctions/payment-api/fee-policy");
  const payment = await reservePayment(pool, input({ fee: undefined, feeRuleVersion: VERSION }), now);
  assert.equal(Number(payment.platform_fee_fen), 2000);
  assert.equal(payment.fee_rule_version, VERSION);
  const again = await reservePayment(pool, input({ fee: undefined, feeRuleVersion: VERSION }), now + 100);
  assert.equal(again.id, payment.id);
  assert.equal(Number(again.platform_fee_fen), 2000);
});

test("fixed percentage rule rejects caller-supplied fee overrides before reservation", async () => {
  const { VERSION } = require("../cloudfunctions/payment-api/fee-policy");
  await assert.rejects(reservePayment(pool, input({ feeRuleVersion: VERSION }), now), code("PAYMENT_FEE_NOT_CONFIGURED"));
  assert.equal((await payments()).length, 0);
});

test("payment creation derives buyer and twenty percent fee from server records", async () => {
  const { createPayment } = require("../cloudfunctions/payment-api/payment-create");
  const event = { action: "createPayment", orderId: "order_1", requestKey: "public_request_00001", expectedVersion: 1 };
  const config = { appid: "test_app", platformMchid: "test_platform", prepayEnabled: true };
  let preparations = 0;
  const prepare = async (db, id) => {
    preparations++;
    const [[payment]] = await db.execute("SELECT * FROM order_payments WHERE id=?", [id]);
    assert.equal(payment.payer_openid, "test_openid");
    assert.equal(Number(payment.platform_fee_fen), 2000);
    assert.equal(payment.fee_rule_version, "PLATFORM_20_PERCENT_V1");
    return { status: "READY", paymentRequest: { package: "prepay_id=test_only" }, privateSnapshot: "must-not-leak" };
  };
  const result = await createPayment(pool, event, { WX_OPENID: "test_openid", WX_APPID: "test_app" }, config, prepare, () => now);
  assert.equal(result.status, "READY");
  assert.equal(preparations, 1);
  assert.deepEqual(Object.keys(result).sort(), ["paymentRequest", "status"]);
});

test("provider and foreign-order payment creation cannot reach channel preparation", async () => {
  const { createPayment } = require("../cloudfunctions/payment-api/payment-create");
  const config = { appid: "test_app", platformMchid: "test_platform", prepayEnabled: true };
  const event = { action: "createPayment", orderId: "order_1", requestKey: "public_request_00001", expectedVersion: 1 };
  const prepare = () => assert.fail("unauthorized channel request");
  await assert.rejects(createPayment(pool, event, { WX_OPENID: "test_provider_openid", WX_APPID: "test_app" }, config, prepare), code("ACCOUNT_NOT_FOUND"));
  await seedOrder("foreign_order");
  await pool.execute("UPDATE order_aggregates SET buyer_id='provider' WHERE id='foreign_order'");
  await assert.rejects(createPayment(pool, { ...event, orderId: "foreign_order" }, { WX_OPENID: "test_openid", WX_APPID: "test_app" }, config, prepare), code("ORDER_NOT_FOUND"));
  assert.equal((await payments()).length, 0);
});

test("prepay rechecks agreement and recipient against current database rows", async () => {
  const { preparePaymentSession } = require("../cloudfunctions/payment-api/prepay-session");
  const config = { ...queryFixture.config, appid: "test_app", prepayEnabled: true, notifyUrl: "https://example.test/payment" };
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'", [config.platformMchid]);
  const payment = await reservePayment(pool, input({ platformMchid: config.platformMchid }), now);
  await pool.execute("UPDATE provider_payment_merchants SET sub_mchid='1900000003' WHERE provider_id='provider'");
  const channel = () => assert.fail("must not submit changed payment");
  await assert.rejects(preparePaymentSession(pool, payment.id, config, channel, () => now + 100), code("PAYMENT_MERCHANT_NOT_READY"));
  await pool.execute("UPDATE provider_payment_merchants SET sub_mchid='1900000002' WHERE provider_id='provider'");
  await pool.execute("UPDATE order_aggregates SET payload=JSON_SET(payload,'$.public.amountFen',10001) WHERE id='order_1'");
  await assert.rejects(preparePaymentSession(pool, payment.id, config, channel, () => now + 100), code("PAYMENT_STATE_CHANGED"));
  assert.equal(Number((await payments())[0].prepay_started_at), 0);
});

test("merchant change during channel request retains prepay id without returning authorization", async () => {
  const { preparePaymentSession } = require("../cloudfunctions/payment-api/prepay-session");
  const config = { ...queryFixture.config, appid: "test_app", prepayEnabled: true, notifyUrl: "https://example.test/payment" };
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'", [config.platformMchid]);
  const payment = await reservePayment(pool, input({ platformMchid: config.platformMchid }), now);
  let calls = 0;
  const channel = async () => {
    calls++;
    await pool.execute("UPDATE provider_payment_merchants SET verified_at=0 WHERE provider_id='provider'");
    return { prepayId: "wx_retained", paymentRequest: {} };
  };
  await assert.rejects(preparePaymentSession(pool, payment.id, config, channel, () => now + 100), code("PAYMENT_MERCHANT_NOT_READY"));
  const saved = (await payments())[0];
  assert.equal(saved.prepay_id, "wx_retained");
  assert.equal(saved.prepay_lease_token, null);
  await assert.rejects(preparePaymentSession(pool, payment.id, config, channel, () => now + 200), code("PAYMENT_MERCHANT_NOT_READY"));
  assert.equal(calls, 1);
});

test('recovery claims one expired attempt and resolves lost close response by verified query', async () => {
  const {recoverPrepay}=require('../cloudfunctions/payment-api/payment-recovery');
  const {preparePaymentSession}=require('../cloudfunctions/payment-api/prepay-session');
  const config={...queryFixture.config,appid:'test_app',prepayEnabled:true,closeEnabled:true,notifyUrl:'https://example.test/payment'};
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,sub_mchid='1900000002' WHERE provider_id='provider'",[config.platformMchid]);
  const p=await reservePayment(pool,input({platformMchid:config.platformMchid}),now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=? WHERE id=?',[now-40000,p.id]);
  let closes=0,closed=false;
  const query=async()=>acceptPaymentQuery(pool,queryResult(p,closed?'CLOSED':'NOTPAY'),notificationFixture.config,p.id,now+100);
  const close=async()=>{
    closes++;
    assert.equal((await preparePaymentSession(pool,p.id,config,()=>assert.fail('no duplicate prepay'),()=>now)).status,'QUERY_REQUIRED');
    closed=true;throw new Error('lost acknowledgement');
  };
  await Promise.all(Array.from({length:10},()=>recoverPrepay(pool,p.id,config,close,query,()=>now)));
  assert.equal(closes,1);assert.equal((await payments())[0].status,'CLOSED');
  assert.equal((await order()).version,2);
  assert.equal((await payments())[0].prepay_lease_token,null);
});

test('recovery does not cancel usable cashier or active prepay request', async () => {
  const {recoverPrepay}=require('../cloudfunctions/payment-api/payment-recovery');
  const p=await reservePayment(pool,input(),now);
  const config={appid:'test_app',platformMchid:'test_platform',closeEnabled:true};
  const unexpected=()=>assert.fail('must not contact channel');
  await pool.execute("UPDATE order_payments SET prepay_started_at=?,prepay_id='wx_usable' WHERE id=?",[now-1000,p.id]);
  await recoverPrepay(pool,p.id,config,unexpected,unexpected,()=>now);
  await pool.execute('UPDATE order_payments SET prepay_id=NULL,prepay_lease_until=? WHERE id=?',[now+1000,p.id]);
  await recoverPrepay(pool,p.id,config,unexpected,unexpected,()=>now);
  assert.equal(Number((await payments())[0].prepay_recovery_started_at),0);
});

test('failed recovery query preserves recovery marker and never assumes closure', async () => {
  const {recoverPrepay}=require('../cloudfunctions/payment-api/payment-recovery');
  const p=await reservePayment(pool,input(),now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=? WHERE id=?',[now-40000,p.id]);
  const config={appid:'test_app',platformMchid:'test_platform',closeEnabled:true};
  await assert.rejects(recoverPrepay(pool,p.id,config,()=>assert.fail('query must precede close'),async()=>{throw new Error('offline');},()=>now),/offline/);
  const saved=(await payments())[0];
  assert.equal(saved.status,'CREATED');assert.equal(Number(saved.prepay_recovery_started_at),now);
  assert.equal(saved.prepay_lease_token,null);assert.equal((await order()).version,1);
});

for (const scenario of ['expired', 'replaced', 'insufficient-time', 'guard-budget']) test(`recovery cannot close after its lease becomes ${scenario}`, async () => {
  const { recoverPrepay, LEASE_MS } = require('../cloudfunctions/payment-api/payment-recovery');
  const p = await reservePayment(pool, input(), now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=? WHERE id=?', [now - 40000, p.id]);
  let currentTime = now, calls = 0;
  const successor = 'f'.repeat(32);
  const query = async () => {
    calls++;
    if (scenario === 'replaced') {
      await pool.execute('UPDATE order_payments SET prepay_lease_token=?,prepay_lease_until=? WHERE id=?',
        [successor, now + LEASE_MS, p.id]);
    } else currentTime = now + LEASE_MS - (scenario === 'expired' ? -1 : scenario === 'guard-budget' ? 13000 : 1000);
    return { status: 'CREATED', channelStatus: 'NOTPAY' };
  };
  let closes = 0;
  await recoverPrepay(pool, p.id, { appid: 'test_app', platformMchid: 'test_platform', closeEnabled: true },
    async () => { closes++; }, query, () => currentTime);
  assert.equal(closes, 0);
  assert.equal(calls, 1);
  const saved = (await payments())[0];
  assert.equal(saved.status, 'CREATED');
  assert.equal(saved.prepay_lease_token, scenario === 'replaced' ? successor : null);
  assert.equal(Number(saved.prepay_recovery_started_at), now);
});

test('receipt discovered after recovery claim skips close and preserves received money', async () => {
  const {recoverPrepay}=require('../cloudfunctions/payment-api/payment-recovery');
  const p=await reservePayment(pool,input(),now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=? WHERE id=?',[now-40000,p.id]);
  const config={appid:'test_app',platformMchid:'test_platform',closeEnabled:true};
  const query=()=>recordPaymentSuccess(pool,result(p),now+100);
  const recovered=await recoverPrepay(pool,p.id,config,()=>assert.fail('paid order must not be closed'),query,()=>now);
  assert.equal(recovered.status,'PAID');
  assert.equal((await payments())[0].status,'PAID');
  assert.equal((await payments())[0].prepay_lease_token,null);
});

test('scheduled reconciliation is bounded, isolates failures and advances past processed rows', async () => {
  const {reconcilePayments}=require('../cloudfunctions/payment-api/payment-reconcile');
  const merchant=queryFixture.config.platformMchid;
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=? WHERE provider_id='provider'",[merchant]);
  for(let i=1;i<=7;i++) {
    if(i>1) await seedOrder(`order_${i}`);
    await reservePayment(pool,input({orderId:`order_${i}`,platformMchid:merchant}),now+i);
  }
  await pool.execute('UPDATE order_payments SET prepay_started_at=?',[now-40000]);
  const config={appid:'test_app',platformMchid:merchant,reconciliationEnabled:true};
  let calls=0;
  const query=async()=>{if(++calls===1)throw new Error('secret upstream error');return {status:'CREATED',channelStatus:'NOTPAY'};};
  const first=await reconcilePayments(pool,config,query,()=>now);
  assert.deepEqual(first,{enabled:true,examined:5,queried:4,skipped:0,failed:1});
  const second=await reconcilePayments(pool,config,query,()=>now);
  assert.equal(second.queried,2);assert.equal(calls,7);
  assert.equal((await reconcilePayments(pool,config,query,()=>now)).examined,0);
  assert.ok((await payments()).every(p=>p.query_lease_token===null));
});

test('scheduled and buyer-triggered query share the same database lease', async () => {
  const {reconcilePayments}=require('../cloudfunctions/payment-api/payment-reconcile');
  const merchant=queryFixture.config.platformMchid;
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=? WHERE provider_id='provider'",[merchant]);
  await reservePayment(pool,input({platformMchid:merchant}),now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=?',[now-40000]);
  const config={appid:'test_app',platformMchid:merchant,reconciliationEnabled:true};
  let started,finish,calls=0;
  const entered=new Promise(resolve=>{started=resolve;});
  const query=()=>new Promise(resolve=>{calls++;finish=resolve;started();});
  const worker=reconcilePayments(pool,config,query,()=>now);
  await entered;
  assert.equal((await refreshPayment(pool,refreshEvent,refreshCaller,config,query,()=>now)).queryStatus,'THROTTLED');
  assert.equal((await reconcilePayments(pool,config,query,()=>now)).examined,0);
  finish({status:'CREATED',channelStatus:'NOTPAY'});await worker;
  assert.equal(calls,1);
});

for (const initialFailure of ['transport','signature']) test(`direct scheduled payment recovery after ${initialFailure} failure posts once despite late callbacks`, async () => {
  const {reconcilePayments}=require('../cloudfunctions/payment-api/payment-reconcile');
  const {runPaymentWorker}=require('../cloudfunctions/payment-api/payment-worker');
  await pool.query('DELETE FROM provider_payment_merchants');
  const cfg={...queryFixture.config,appid:'test_app',paymentMode:'DIRECT',reconciliationEnabled:true,closeEnabled:false};
  const p=await reservePayment(pool,input({platformMchid:cfg.platformMchid,paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
  await pool.execute('UPDATE order_payments SET prepay_started_at=? WHERE id=?',[now-40000,p.id]);
  const transaction={appid:p.appid,mchid:p.platform_mchid,out_trade_no:p.id,transaction_id:`direct_${p.id}`,
    trade_type:'JSAPI',trade_state:'SUCCESS',payer:{openid:p.payer_openid},success_time:new Date(now).toISOString(),
    amount:{total:10000,payer_total:9800,currency:'CNY',payer_currency:'CNY'}};
  const token='f'.repeat(64),workerEnv={SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_QUERY_WORKER_TOKEN:token};
  let currentTime=now,calls=0,broken=true;
  const query=(db,id,config)=>{
    calls++;
    if(broken&&initialFailure==='transport')throw Error('simulated channel timeout');
    const response=notificationFixture.sign(JSON.stringify(transaction),currentTime);
    if(broken)response.body=Buffer.from(JSON.stringify({...transaction,transaction_id:'tampered'}));
    return queryPayment(db,id,config,queryFixture.requestFor(response,options=>assert.equal(options.method,'GET')),()=>currentTime);
  };
  const run=()=>runPaymentWorker({workerToken:token},{},workerEnv,()=>({pool,config:cfg}),
    (db,config)=>reconcilePayments(db,config,query,()=>currentTime));
  assert.equal((await run()).data.failed,1);
  const unchanged=(await payments())[0];
  assert.equal(unchanged.status,'CREATED');assert.equal(unchanged.query_lease_token,null);assert.equal((await order()).version,1);
  assert.equal((await pool.query('SELECT * FROM fund_journals'))[0].length,0);
  broken=false;currentTime+=60001;
  assert.equal((await run()).data.queried,1);assert.equal(calls,2);
  assert.equal((await payments())[0].status,'PAID');assert.equal((await order()).version,2);
  const notification=notificationFixture.notify(transaction,currentTime);
  await Promise.all(Array.from({length:5},()=>acceptPaymentNotification(pool,notification,cfg,currentTime)));
  assert.equal((await run()).data.examined,0);assert.equal(calls,2);assert.equal((await order()).version,2);
  const [journals]=await pool.query('SELECT * FROM fund_journals');assert.equal(journals.length,1);
  const [postings]=await pool.query('SELECT account,direction,amount_fen FROM fund_postings ORDER BY account');
  assert.deepEqual(postings.map(row=>[row.account,row.direction,Number(row.amount_fen)]),[
    ['CHANNEL_RECEIVABLE','DEBIT',10000],['PLATFORM_PENDING','CREDIT',2000],['PROVIDER_PENDING','CREDIT',8000]]);
});

test('disabled scheduled reconciliation cannot touch the database or payment channel', async () => {
  const {reconcilePayments}=require('../cloudfunctions/payment-api/payment-reconcile');
  assert.deepEqual(await reconcilePayments({execute(){assert.fail('disabled database access');}}, {},()=>assert.fail('disabled channel')),
    {enabled:false});
});

test('deployment schema inspection verifies real migrated metadata and detects an incomplete rollout', async () => {
  const {inspectPaymentSchema}=require('./mysql-readonly-preflight');
  assert.deepEqual(await inspectPaymentSchema(pool,database),{columnIssues:[],indexIssues:[]});
  // Only this suite's isolated database is altered; restore before other tests can run.
  await pool.query('ALTER TABLE order_payments MODIFY prepay_id VARCHAR(127) CHARACTER SET ascii COLLATE ascii_bin NULL');
  await pool.query('DROP INDEX idx_payment_reconcile_due ON order_payments');
  try {
    const report=await inspectPaymentSchema(pool,database);
    assert.deepEqual(report.columnIssues,[{table:'order_payments',column:'prepay_id',issue:'TYPE_MISMATCH'}]);
    assert.equal(report.indexIssues.length,1);
    assert.deepEqual(report.indexIssues[0].columns,['appid','platform_mchid','status','query_started_at','created_at','id']);
  } finally {
    await pool.query('ALTER TABLE order_payments MODIFY prepay_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL');
    await pool.query('CREATE INDEX idx_payment_reconcile_due ON order_payments (appid,platform_mchid,status,query_started_at,created_at,id)');
  }
});

test('accepted durable intent reaches exactly one settlement task across concurrent scans', async () => {
  const {prepareAcceptedSettlements}=require('../cloudfunctions/payment-api/settlement-dispatch');
  const p=await seedAcceptedSettlement();
  // The fixture starts with a nonnumeric merchant; bind both immutable test records for this scanner test.
  await pool.execute('UPDATE order_payments SET platform_mchid=? WHERE id=?',[queryFixture.config.platformMchid,p.id]);
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=? WHERE provider_id='provider'",[queryFixture.config.platformMchid]);
  const config={appid:'test_app',platformMchid:queryFixture.config.platformMchid,settlementPreparationEnabled:true};
  await Promise.all(Array.from({length:10},()=>prepareAcceptedSettlements(pool,config,null,()=>now+300)));
  const [tasks]=await pool.execute('SELECT * FROM order_settlement_tasks');
  assert.equal(tasks.length,1);assert.equal(tasks[0].status,'PREPARED');assert.equal(tasks[0].attempts,0);
  assert.equal((await prepareAcceptedSettlements(pool,config,null,()=>now+400)).examined,0);
});

test('unready settlement intent survives scan failure and is prepared after readiness is restored', async () => {
  const {prepareAcceptedSettlements}=require('../cloudfunctions/payment-api/settlement-dispatch');
  const p=await seedAcceptedSettlement();
  const merchant=queryFixture.config.platformMchid;
  await pool.execute('UPDATE order_payments SET platform_mchid=? WHERE id=?',[merchant,p.id]);
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid=?,verified_at=0 WHERE provider_id='provider'",[merchant]);
  const config={appid:'test_app',platformMchid:merchant,settlementPreparationEnabled:true};
  assert.equal((await prepareAcceptedSettlements(pool,config,null,()=>now+300)).deferred,1);
  assert.equal((await order()).payload.settlementIntent.status,'PENDING');
  assert.equal((await prepareAcceptedSettlements(pool,{...config,appid:'foreign_app'},null,()=>now+300)).examined,0);
  await pool.execute("UPDATE provider_payment_merchants SET verified_at=1 WHERE provider_id='provider'");
  assert.equal((await prepareAcceptedSettlements(pool,config,null,()=>now+400)).prepared,1);
  assert.deepEqual(await prepareAcceptedSettlements({execute(){assert.fail('disabled read');}},{}),{enabled:false});
});

async function seedDirectRefundPayment() {
  const payment = await reservePayment(pool, input({ paymentMode: 'DIRECT', fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' }), now);
  await recordPaymentSuccess(pool, result(payment, { paymentMode: 'DIRECT', transactionId: payment.id }), now + 100);
  return { orderId: 'order_1', paymentId: payment.id, buyerId: 'buyer', requestKey: 'refund_request_0001', amountFen: 3000, reason: '双方协商退款' };
}

async function netFixture(){
  const {paymentId}=await seedDirectRefundPayment();
  const [[payment]]=await pool.execute('SELECT p.*,o.provider_id FROM order_payments p JOIN order_aggregates o ON o.id=p.order_id WHERE p.id=?',[paymentId]);
  const importId=crypto.randomBytes(16).toString('hex'),hash='a'.repeat(64);
  const row={paymentId,orderId:payment.order_id,providerId:payment.provider_id,
    providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'20',surchargeFen:'2',providerNetFen:'7878'};
  const snapshot={resultId:importId,batchId:'b'.repeat(32),sourceSha256:hash,operatorId:'finance',
    evidenceReference:'synthetic-fixture',records:[{...row,taxPeriod:'2026-09',withholdingFen:'122',basisReference:'fixture'}],
    status:'VALIDATED_DRAFT',payable:false,remainingChecks:['LIVE_SOURCE_AND_HOLD_RECHECK','AUTHORIZED_FINANCE_APPROVAL','ATOMIC_NET_LEDGER_CREDIT']};
  const {financeResultFingerprint}=require('../cloudfunctions/payment-api/finance-result-fingerprint');
  await pool.execute('INSERT INTO finance_result_imports VALUES(?,?,?,?,?,?,?,?,?,?)',
    [importId,payment.appid,payment.platform_mchid,importId,'b'.repeat(32),hash,financeResultFingerprint(snapshot),JSON.stringify(snapshot),'finance',now]);
  return {payment,importId,hash,row};
}
test('net ledger writer atomically links evidence and balanced postings; duplicate payment fails',async()=>{
  const {postFinanceNet}=require('../cloudfunctions/payment-api/fund-ledger'),f=await netFixture();
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const posted=await postFinanceNet(connection,f.payment,f.importId,f.hash,f.row,'finance',now+200);
    await connection.commit();
    const [[source]]=await pool.execute('SELECT * FROM finance_net_settlements WHERE payment_id=?',[f.payment.id]);
    assert.equal(source.import_id,f.importId);assert.equal(source.journal_id,posted.journalId);
    const [entries]=await pool.execute('SELECT * FROM fund_postings WHERE journal_id=?',[posted.journalId]);
    const sum=direction=>entries.filter(r=>r.direction===direction).reduce((n,r)=>n+BigInt(r.amount_fen),0n);
    assert.equal(sum('DEBIT'),8000n);assert.equal(sum('CREDIT'),8000n);
    assert.equal(entries.some(r=>r.account==='PLATFORM_PENDING'||r.account==='CHANNEL_RECEIVABLE'),false);
    await connection.beginTransaction();
    await assert.rejects(postFinanceNet(connection,f.payment,f.importId,f.hash,f.row,'finance',now+201),e=>e.code==='ER_DUP_ENTRY');
    await connection.rollback();
    const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM finance_net_settlements WHERE payment_id=?',[f.payment.id]);
    assert.equal(Number(count.n),1);
  }finally{await connection.rollback();connection.release();}
});
test('net ledger writer late failure leaves no partial journal after caller rollback',async()=>{
  const {postFinanceNet}=require('../cloudfunctions/payment-api/fund-ledger'),f=await netFixture();
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    await assert.rejects(postFinanceNet(connection,f.payment,'f'.repeat(32),f.hash,f.row,'finance',now+200),e=>e.code==='ER_NO_REFERENCED_ROW_2');
    await connection.rollback();
    const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM fund_journals WHERE id=?',[`net:${f.payment.id}`]);
    assert.equal(Number(count.n),0);
    const [[sources]]=await pool.execute('SELECT COUNT(*) AS n FROM finance_net_settlements WHERE payment_id=?',[f.payment.id]);
    assert.equal(Number(sources.n),0);
  }finally{await connection.rollback();connection.release();}
});
test('20 concurrent refund retries reserve one amount and persist the original fee snapshot', async () => {
  const request = await seedDirectRefundPayment();
  const results = await Promise.all(Array.from({ length: 20 }, () => requestRefund(pool, request, 'test_platform', now + 200)));
  assert.equal(new Set(results.map(row => row.id)).size, 1);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refunds');
  assert.equal(Number(count.n), 1);
  const row = results[0];
  assert.equal(Number(row.amount_fen), 3000); assert.equal(Number(row.total_fen), 10000);
  assert.equal(Number(row.platform_fee_fen), 2000); assert.equal(row.fee_rule_version, 'PLATFORM_20_PERCENT_V1');
  assert.equal(row.status, 'REQUESTED'); assert.equal(row.settlement_review_required, 0);
  const [[hold]] = await pool.execute('SELECT * FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'REFUND_REQUEST');
});
test('completed orders reject new refunds but preserve original request recovery', async () => {
  const request = await seedDirectRefundPayment();
  const original = await requestRefund(pool, request, 'test_platform', now + 200);
  await pool.execute("UPDATE order_aggregates SET stage='COMPLETED' WHERE id='order_1'");
  assert.equal((await requestRefund(pool, request, 'test_platform', now + 201)).id, original.id);
  await assert.rejects(requestRefund(pool, { ...request, requestKey:'refund_after_completed' }, 'test_platform', now + 202), code('REFUND_ORDER_COMPLETED'));
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refunds');
  assert.equal(Number(count.n), 1);
});
test('refund hold invalidates acceptance prepared from an earlier order version', async () => {
  const request = await seedDirectRefundPayment(), before = await order();
  await requestRefund(pool, request, 'test_platform', now + 200);
  const [changed] = await pool.execute("UPDATE order_aggregates SET stage='COMPLETED',version=version+1 WHERE id=? AND version=?", ['order_1', before.version]);
  assert.equal(changed.affectedRows, 0);
  assert.notEqual((await order()).stage, 'COMPLETED');
});
test('concurrent actual acceptance and ordinary refund cannot both commit', async () => {
  const request = await seedDirectRefundPayment();
  await pool.execute(`UPDATE order_aggregates SET stage='DELIVERY_PENDING',
    payload=JSON_SET(payload,'$.public.deliveryNote','服务完成','$.public.provider.career','妆娘') WHERE id='order_1'`);
  const before = await order();
  const results = await Promise.allSettled([
    handleOrder(databaseReader(), {action:'transitionOrder',orderId:'order_1',expectedVersion:Number(before.version),event:'BUYER_ACCEPTS_DELIVERY'},
      {WX_OPENID:'test_openid'}, contactKey, now+200),
    requestRefund(pool,request,'test_platform',now+200)
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(['REFUND_ORDER_COMPLETED','ORDER_FUNDS_HELD','VERSION_CONFLICT'].includes(results.find(r=>r.status==='rejected').reason.code));
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM order_refunds');
  assert.equal((await order()).stage==='COMPLETED',Number(count.n)===0);
});
test('concurrent distinct refunds cannot jointly over-reserve the original payment', async () => {
  const request = await seedDirectRefundPayment();
  const results = await Promise.allSettled([1,2].map(n => requestRefund(pool,
    { ...request, requestKey: `refund_request_000${n}`, amountFen: 6000 }, 'test_platform', now + 200)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'REFUND_AMOUNT_EXCEEDED');
  const [[sum]] = await pool.execute('SELECT SUM(amount_fen) AS reserved FROM order_refunds');
  assert.equal(Number(sum.reserved), 6000);
});
test('refund retries reject changed amounts and reasons; another buyer cannot inspect or reserve', async () => {
  const request = await seedDirectRefundPayment();
  await assert.rejects(requestRefund(pool, { ...request, buyerId: 'provider' }, 'test_platform', now + 200), code('ORDER_NOT_FOUND'));
  await assert.rejects(requestRefund(pool, request, 'wrong_merchant', now + 200), code('REFUND_IDENTITY_MISMATCH'));
  const [[empty]] = await pool.execute('SELECT COUNT(*) AS n FROM order_funds_interlocks');
  assert.equal(Number(empty.n), 0);
  await requestRefund(pool, request, 'test_platform', now + 200);
  for (const patch of [{ amountFen: 4000 }, { reason: 'changed reason' }]) {
    await assert.rejects(requestRefund(pool, { ...request, ...patch }, 'test_platform', now + 201), code('REFUND_IDEMPOTENCY_CONFLICT'));
  }
});
test('refund request preserves disputes and marks an already fenced settlement for review', async () => {
  const request = await seedDirectRefundPayment();
  await pool.execute("INSERT INTO order_funds_interlocks(order_id,hold_reason,held_at,settlement_task_id,settlement_started_at) VALUES(?,'DISPUTE',?,?,?)",
    ['order_1', now + 110, 'c'.repeat(32), now + 105]);
  const row = await requestRefund(pool, request, 'test_platform', now + 200);
  assert.equal(row.status, 'REQUESTED'); assert.equal(row.settlement_review_required, 1);
  const [[hold]] = await pool.execute('SELECT * FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'DISPUTE'); assert.equal(Number(hold.held_at), now + 110);
});
test('unpaid or incorrect fee snapshots cannot leave refund records or holds', async () => {
  const request = await seedDirectRefundPayment();
  await seedOrder('unpaid_refund');
  const unpaid = await reservePayment(pool, input({ orderId: 'unpaid_refund', paymentMode: 'DIRECT', fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' }), now);
  await assert.rejects(requestRefund(pool, { ...request, orderId: 'unpaid_refund', paymentId: unpaid.id }, 'test_platform', now + 200), code('REFUND_PAYMENT_NOT_READY'));
  await pool.execute('UPDATE order_payments SET fee_rule_version=? WHERE id=?', ['UNKNOWN', request.paymentId]);
  await assert.rejects(requestRefund(pool, request, 'test_platform', now + 200), code('REFUND_FEE_SNAPSHOT_MISMATCH'));
  const [[empty]] = await pool.execute('SELECT (SELECT COUNT(*) FROM order_refunds) AS refunds, (SELECT COUNT(*) FROM order_funds_interlocks) AS holds');
  assert.equal(Number(empty.refunds), 0); assert.equal(Number(empty.holds), 0);
});

const { reviewRefund } = require('../cloudfunctions/payment-api/refund-store');
const reviewInput = (refundId, decision = 'APPROVE') => ({ refundId, reviewerId: 'test_operator', decision, evidenceReference: 'test_case_evidence_1' });

test('operator abnormal receipts preserve actual amounts and stable pagination without leaking payer identity',async()=>{
  const {listPaymentReviews}=require('../cloudfunctions/payment-api/payment-review-read');const ids=[];
  for(let i=0;i<22;i++) {
    const orderId=`abnormal_queue_${i}`;await seedOrder(orderId);
    const p=await reservePayment(pool,input({orderId,paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
    await recordPaymentSuccess(pool,result(p,{paymentMode:'DIRECT',totalFen:12000,currency:i===0?'USD':'CNY'}),now+200);ids.push(p.id);
  }
  const scope={appid:'test_app',platformMchid:'test_platform'};
  const first=await listPaymentReviews(pool,null,scope),second=await listPaymentReviews(pool,first.nextCursor,scope);
  assert.equal(first.records.length,20);assert.equal(second.records.length,2);assert.equal(second.nextCursor,null);
  const records=[...first.records,...second.records];assert.deepEqual(records.map(row=>row.paymentId),ids.sort().reverse());
  assert.ok(records.every(row=>row.expectedAmountFen===10000&&row.receivedAmountFen===12000&&row.reason==='AMOUNT_OR_CURRENCY_MISMATCH'));
  assert.equal(records.filter(row=>row.receivedCurrency==='USD').length,1);
  assert.doesNotMatch(JSON.stringify(records),/test_openid|transactionId|transaction_id|payer_openid/);
  for(const changed of [{...scope,appid:'other'},{...scope,platformMchid:'other'}])assert.deepEqual(await listPaymentReviews(pool,null,changed),{records:[],nextCursor:null});
  await assert.rejects(listPaymentReviews(pool,{paidAt:now,id:'bad'},scope),/PAYMENT_REVIEW_INPUT_INVALID/);
});

test('abnormal DIRECT receipt posts actual currency and amount to suspense once without income',async()=>{
  const {auditPaymentFunds}=require('../cloudfunctions/payment-api/fund-audit');
  for(const currency of ['CNY','USD']) {
    const orderId=`review_ledger_${currency}`;await seedOrder(orderId);
    const payment=await reservePayment(pool,input({orderId,paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
    const receipt=result(payment,{paymentMode:'DIRECT',totalFen:12000,currency});
    assert.equal((await recordPaymentSuccess(pool,receipt,now+200)).status,'PAID_REQUIRES_REVIEW');
    assert.equal((await recordPaymentSuccess(pool,receipt,now+201)).duplicate,true);
    const [[journal]]=await pool.execute('SELECT * FROM fund_journals WHERE payment_id=?',[payment.id]);
    assert.equal(journal.event_type,'PAYMENT_REVIEW_RECEIVED');assert.equal(journal.currency,currency);
    const [entries]=await pool.execute('SELECT * FROM fund_postings WHERE journal_id=? ORDER BY account',[journal.id]);
    assert.equal(entries.length,2);
    assert.deepEqual(entries.map(row=>[row.account,row.direction,Number(row.amount_fen)]),
      [['CHANNEL_RECEIVABLE','DEBIT',12000],['REVIEW_SUSPENSE','CREDIT',12000]]);
    const audit=await auditPaymentFunds(pool,payment.id);
    assert.deepEqual(audit.issues.map(row=>row.code),['PAYMENT_REVIEW_REQUIRED']);assert.equal(audit.ok,false);
    await pool.execute("UPDATE fund_postings SET amount_fen=11000 WHERE journal_id=?",[journal.id]);
    assert.ok((await auditPaymentFunds(pool,payment.id)).issues.some(row=>row.code==='REVIEW_POSTING_MISMATCH'));
  }
});

test('suspense posting failure rolls back abnormal receipt and order projection',async()=>{
  const payment=await reservePayment(pool,input({paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
  await pool.query("CREATE TRIGGER fail_suspense BEFORE INSERT ON fund_postings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
  try {
    await assert.rejects(recordPaymentSuccess(pool,result(payment,{paymentMode:'DIRECT',totalFen:12000}),now+200),/test rollback/);
    const [[saved]]=await pool.execute('SELECT transaction_id,status FROM order_payments WHERE id=?',[payment.id]);
    assert.equal(saved.transaction_id,null);assert.equal(saved.status,'CREATED');
    const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM fund_journals WHERE payment_id=?',[payment.id]);assert.equal(Number(count.n),0);
    assert.equal((await order()).payload.public.paymentStatus,'UNPAID');
  }finally{await pool.query('DROP TRIGGER fail_suspense');}
});

test('operator refund queue paginates same-time requests, filters status and isolates merchant/app',async()=>{
  const {listOperatorRefunds}=require('../cloudfunctions/payment-api/refund-operator-read');
  const request=await seedDirectRefundPayment(),ids=[];
  for(let i=0;i<25;i++) ids.push((await requestRefund(pool,{...request,amountFen:1,
    requestKey:`operator_queue_${String(i).padStart(8,'0')}`},'test_platform',now+200)).id);
  const scope={appid:'test_app',platformMchid:'test_platform'},filter={status:'REQUESTED'};
  const first=await listOperatorRefunds(pool,filter,scope);
  const second=await listOperatorRefunds(pool,{...filter,cursor:first.nextCursor},scope);
  assert.equal(first.records.length,20);assert.equal(second.records.length,5);assert.equal(second.nextCursor,null);
  const seen=[...first.records,...second.records].map(row=>row.refundId);
  assert.equal(new Set(seen).size,25);assert.deepEqual(seen,[...ids].sort().reverse());
  for(const changed of [{...scope,appid:'other'},{...scope,platformMchid:'other'}]) {
    assert.deepEqual(await listOperatorRefunds(pool,filter,changed),{records:[],nextCursor:null});
  }
  await reviewRefund(pool,reviewInput(ids[0],'REJECT'),now+300);
  const rejected=await listOperatorRefunds(pool,{status:'REJECTED'},scope);
  assert.deepEqual(rejected.records.map(row=>row.refundId),[ids[0]]);
  await assert.rejects(listOperatorRefunds(pool,{status:'REJECTED',cursor:first.nextCursor},scope),/REFUND_OPERATOR_INPUT_INVALID/);
  assert.doesNotMatch(JSON.stringify(first),/reason|payer|reviewed_by|transaction/);
});

test('operator refund snapshot scopes merchant and app, exposes review facts without payer details',async()=>{
  const {readOperatorRefund}=require('../cloudfunctions/payment-api/refund-operator-read');
  const request=await seedDirectRefundPayment();
  const refund=await requestRefund(pool,request,'test_platform',now+200);
  const scope={appid:'test_app',platformMchid:'test_platform'};
  const pending=await readOperatorRefund(pool,refund.id,scope);
  assert.equal(pending.status,'REQUESTED');assert.equal(pending.holdReason,'REFUND_REQUEST');
  assert.equal(pending.amountFen,request.amountFen);assert.equal(pending.totalFen,10000);
  assert.equal(pending.decision,null);assert.equal(pending.submissionStartedAt,null);
  for(const changed of [{...scope,appid:'other'},{...scope,platformMchid:'other'}]) {
    await assert.rejects(readOperatorRefund(pool,refund.id,changed),/REFUND_NOT_FOUND/);
  }
  await reviewRefund(pool,reviewInput(refund.id),now+300);
  const approved=await readOperatorRefund(pool,refund.id,scope);
  assert.equal(approved.status,'APPROVED');assert.equal(approved.reviewerId,'test_operator');
  assert.equal(approved.evidenceReference,'test_case_evidence_1');assert.equal(approved.reviewedAt,now+300);
  assert.equal(approved.refundedFen,0);
  assert.doesNotMatch(JSON.stringify(approved),/payer_openid|test_openid|transaction_id|submission_lease_token/);
});
test('concurrent identical refund approvals preserve one decision and evidence', async () => {
  const request = await seedDirectRefundPayment();
  const refund = await requestRefund(pool, request, 'test_platform', now + 200);
  const results = await Promise.all(Array.from({ length: 10 }, () => reviewRefund(pool, reviewInput(refund.id), now + 300)));
  assert.ok(results.every(row => row.status === 'APPROVED' && row.reviewed_by === 'test_operator' && row.evidence_reference === 'test_case_evidence_1'));
  await assert.rejects(reviewRefund(pool, { ...reviewInput(refund.id), evidenceReference: 'different_evidence' }, now + 301), code('REFUND_REVIEW_CONFLICT'));
  const [[hold]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'REFUND_REQUEST');
});
test('concurrent approve and reject commit one decision without overwriting the winner', async () => {
  const refund = await requestRefund(pool, await seedDirectRefundPayment(), 'test_platform', now + 200);
  const results = await Promise.allSettled(['APPROVE','REJECT'].map(decision => reviewRefund(pool, reviewInput(refund.id, decision), now + 300)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'REFUND_REVIEW_CONFLICT');
  const [[stored]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.review_decision, results.find(row => row.status === 'fulfilled').value.review_decision);
});
test('rejecting one request preserves the other hold; rejecting the last releases only refund capacity', async () => {
  const request = await seedDirectRefundPayment();
  const first = await requestRefund(pool, request, 'test_platform', now + 200);
  const second = await requestRefund(pool, { ...request, requestKey: 'refund_request_0002' }, 'test_platform', now + 201);
  await reviewRefund(pool, reviewInput(first.id, 'REJECT'), now + 300);
  const [[held]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(held.hold_reason, 'REFUND_REQUEST');
  await reviewRefund(pool, reviewInput(second.id, 'REJECT'), now + 301);
  const [[released]] = await pool.execute('SELECT hold_reason,held_at FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(released.hold_reason, null); assert.equal(released.held_at, null);
  const replacement = await requestRefund(pool, { ...request, requestKey: 'refund_request_0003', amountFen: 10000 }, 'test_platform', now + 302);
  assert.equal(Number(replacement.amount_fen), 10000);
});
test('refund approval cannot bypass a new dispute and rejection cannot clear that dispute', async () => {
  const refund = await requestRefund(pool, await seedDirectRefundPayment(), 'test_platform', now + 200);
  await require('../cloudfunctions/payment-api/funds-interlock').holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 250);
  await assert.rejects(reviewRefund(pool, reviewInput(refund.id), now + 300), code('REFUND_DISPUTE_REVIEW_REQUIRED'));
  await reviewRefund(pool, reviewInput(refund.id, 'REJECT'), now + 301);
  const [[hold]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'DISPUTE');
});
test('settlement fence blocks approval and survives rejection', async () => {
  const refund = await requestRefund(pool, await seedDirectRefundPayment(), 'test_platform', now + 200);
  await pool.execute('UPDATE order_funds_interlocks SET settlement_task_id=?,settlement_started_at=? WHERE order_id=?', ['c'.repeat(32), now + 220, 'order_1']);
  await assert.rejects(reviewRefund(pool, reviewInput(refund.id), now + 300), code('REFUND_SETTLEMENT_REVIEW_REQUIRED'));
  await reviewRefund(pool, reviewInput(refund.id, 'REJECT'), now + 301);
  const [[hold]] = await pool.execute('SELECT * FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'REFUND_REQUEST'); assert.equal(hold.settlement_task_id, 'c'.repeat(32));
});

const { claimRefund, executeRefund } = require('../cloudfunctions/payment-api/refund-execution');
const refundConfig = { refundEnabled: true, platformMchid: 'test_platform', appid: 'test_app' };
async function seedApprovedRefund(amountFen = 3000) {
  const input = { ...await seedDirectRefundPayment(), amountFen };
  const refund = await requestRefund(pool, input, 'test_platform', now + 200);
  await reviewRefund(pool, reviewInput(refund.id), now + 300);
  return refund;
}

test('approved minimum refund and ledger grants support payment and refund transactions without ledger edits', async () => {
  const user=`refund_${crypto.randomBytes(6).toString('hex')}`, password=crypto.randomBytes(24).toString('hex');
  let restricted;
  await admin.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}'`);
  try {
    const grants=[['accounts','SELECT'],['wechat_identities','SELECT'],['account_roles','SELECT'],
      ['provider_payment_merchants','SELECT'],['order_aggregates','SELECT, UPDATE'],
      ['order_payments','SELECT, INSERT, UPDATE'],['order_funds_interlocks','SELECT, INSERT, UPDATE'],
      ['order_refunds','SELECT, INSERT, UPDATE'],['order_refund_reversals','SELECT, INSERT'],
      ['fund_journals','SELECT, INSERT'],['fund_postings','INSERT']];
    for(const [table,privileges] of grants) await admin.query(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${user}'@'127.0.0.1'`);
    restricted=mysql.createPool({...config,database,user,password,connectionLimit:4});
    const payment=await reservePayment(restricted,input({paymentMode:'DIRECT',fee:undefined,feeRuleVersion:'PLATFORM_20_PERCENT_V1'}),now);
    await recordPaymentSuccess(restricted,result(payment,{paymentMode:'DIRECT',transactionId:payment.id}),now+100);
    const request={orderId:'order_1',paymentId:payment.id,buyerId:'buyer',requestKey:'refund_minimum_permissions',amountFen:3000,reason:'双方协商退款'};
    const refund=await requestRefund(restricted,request,'test_platform',now+200);
    await reviewRefund(restricted,reviewInput(refund.id),now+300);
    await claimRefund(restricted,refund.id,refundConfig,now+400);
    await recordRefundResult(restricted,refundReceipt(refund),now+600);
    await recordRefundResult(restricted,refundReceipt(refund),now+700);
    const [[stored]]=await pool.execute('SELECT refunded_fen,platform_refunded_fen,provider_refunded_fen FROM order_payments WHERE id=?',[payment.id]);
    assert.deepEqual(Object.values(stored).map(Number),[3000,600,2400]);
    const [[journalCount]]=await pool.execute('SELECT COUNT(*) AS n FROM fund_journals');
    const [[postingCount]]=await pool.execute('SELECT COUNT(*) AS n FROM fund_postings');
    assert.equal(Number(journalCount.n),2);assert.equal(Number(postingCount.n),6);
    for(const sql of ['DELETE FROM order_refunds','UPDATE order_refund_reversals SET refund_fen=1',
      'DELETE FROM fund_journals','UPDATE fund_postings SET amount_fen=1','SELECT * FROM fund_postings']) {
      await assert.rejects(restricted.execute(sql),error=>[1142,1143].includes(error.errno));
    }
  } finally {
    if(restricted) await restricted.end();
    await admin.query(`DROP USER '${user}'@'127.0.0.1'`);
  }
});
test('concurrent refund execution calls the channel once and records processing without releasing funds', async () => {
  const refund = await seedApprovedRefund();
  let calls = 0;
  const channel = async snapshot => { calls++; assert.equal(snapshot.id, refund.id); return { refundId: refund.id, channelRefundId: 'test_channel_refund', status: 'PROCESSING' }; };
  const results = await Promise.all(Array.from({ length: 20 }, () => executeRefund(pool, refund.id, refundConfig, channel, () => now + 400)));
  assert.equal(calls, 1); assert.equal(results.filter(row => row.status === 'PROCESSING').length, 1);
  assert.ok(results.every(row => ['BUSY','QUERY_REQUIRED','PROCESSING'].includes(row.status)));
  const [[stored]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'PROCESSING'); assert.equal(stored.channel_refund_id, 'test_channel_refund');
  assert.equal(stored.submission_lease_token, null);
  const [[hold]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'REFUND_REQUEST');
});
test('unknown refund submission survives reload and expiration without automatic resubmission', async () => {
  const refund = await seedApprovedRefund();
  let calls = 0;
  await assert.rejects(executeRefund(pool, refund.id, refundConfig, async () => { calls++; throw Error('timeout'); }, () => now + 400), /timeout/);
  const [[stored]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'SUBMITTING'); assert.equal(Number(stored.submission_started_at), now + 400);
  assert.equal((await claimRefund(pool, refund.id, refundConfig, now + 500)).status, 'BUSY');
  const later = await executeRefund(pool, refund.id, refundConfig, async () => { calls++; }, () => now + 40000);
  assert.equal(later.status, 'QUERY_REQUIRED'); assert.equal(calls, 1);
});
test('new disputes and another in-flight refund block execution after approval', async () => {
  const first = await seedApprovedRefund();
  const second = await requestRefund(pool, { orderId: first.order_id, paymentId: first.payment_id, buyerId: 'buyer',
    requestKey: 'refund_request_0002', amountFen: 3000, reason: '第二次退款' }, 'test_platform', now + 310);
  await reviewRefund(pool, reviewInput(second.id), now + 320);
  await executeRefund(pool, first.id, refundConfig, async () => ({ refundId: first.id, channelRefundId: 'test_refund_first', status: 'PROCESSING' }), () => now + 400);
  assert.equal((await claimRefund(pool, second.id, refundConfig, now + 70000)).status, 'DEFERRED');
  await pool.execute("UPDATE order_refunds SET status='SUCCESS',succeeded_at=? WHERE id=?", [now + 450, first.id]);
  assert.equal((await claimRefund(pool, second.id, refundConfig, now + 500)).status, 'DEFERRED');
  await require('../cloudfunctions/payment-api/funds-interlock').holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 600);
  assert.equal((await claimRefund(pool, second.id, refundConfig, now + 70000)).status, 'DEFERRED');
});
test('insufficient execution lease preserves durable submission fence', async () => {
  const refund = await seedApprovedRefund();
  const times = [now + 400, now + 20000];
  const result = await executeRefund(pool, refund.id, refundConfig, () => assert.fail('insufficient budget'), () => times.shift());
  assert.equal(result.status, 'QUERY_REQUIRED');
  const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'SUBMITTING');
});
test('disabled refund execution does not touch database', async () => {
  assert.deepEqual(await executeRefund({ execute() { assert.fail('disabled database'); } }, 'x', {}), { status: 'DISABLED' });
});

test('invalid channel acknowledgement cannot become processing or release its fence', async () => {
  const refund = await seedApprovedRefund();
  await assert.rejects(executeRefund(pool, refund.id, refundConfig,
    async () => ({ refundId: 'd'.repeat(32), channelRefundId: 'unrelated_refund', status: 'PROCESSING' }), () => now + 400), code('REFUND_RESPONSE_INVALID'));
  const [[stored]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'SUBMITTING'); assert.equal(stored.channel_refund_id, null);
  assert.ok(stored.submission_lease_token);
});

const { recordRefundResult, refreshRefund } = require('../cloudfunctions/payment-api/refund-results');
const { createRefundRequest } = require('../cloudfunctions/payment-api/refund-request');
const { readRefundRequest } = require('../cloudfunctions/payment-api/refund-read');
test('concurrent refund scans query one unknown submission and commit its verified result once', async () => {
  const { reconcileRefunds } = require('../cloudfunctions/payment-api/refund-reconcile');
  const refund = await seedApprovedRefund();
  await claimRefund(pool,refund.id,refundConfig,now+400);
  const merchant='1750932981';
  await pool.execute('UPDATE order_payments SET platform_mchid=? WHERE id=?',[merchant,refund.payment_id]);
  await pool.execute('UPDATE order_refunds SET platform_mchid=? WHERE id=?',[merchant,refund.id]);
  const config={...refundConfig,platformMchid:merchant,refundReconciliationEnabled:true};
  let calls=0;
  const reports=await Promise.all(Array.from({length:10},()=>reconcileRefunds(pool,config,async row=>{
    calls++;assert.equal(row.id,refund.id);return refundReceipt(refund);
  },()=>now+40000)));
  assert.equal(calls,1);assert.equal(reports.reduce((n,r)=>n+r.failed,0),0);
  const [[stored]]=await pool.execute('SELECT status,query_lease_token FROM order_refunds WHERE id=?',[refund.id]);
  assert.equal(stored.status,'SUCCESS');assert.equal(stored.query_lease_token,null);
});
test('refund scan failures retain submission and throttle another scan without resubmission', async () => {
  const { reconcileRefunds } = require('../cloudfunctions/payment-api/refund-reconcile');
  const refund=await seedApprovedRefund();await claimRefund(pool,refund.id,refundConfig,now+400);
  const merchant='1750932981';
  await pool.execute('UPDATE order_payments SET platform_mchid=? WHERE id=?',[merchant,refund.payment_id]);
  await pool.execute('UPDATE order_refunds SET platform_mchid=? WHERE id=?',[merchant,refund.id]);
  const config={...refundConfig,platformMchid:merchant,refundReconciliationEnabled:true};
  let calls=0;const query=async()=>{calls++;throw Error('upstream private detail');};
  assert.equal((await reconcileRefunds(pool,config,query,()=>now+500)).examined,0);
  assert.equal((await reconcileRefunds(pool,config,query,()=>now+40000)).failed,1);
  assert.equal((await reconcileRefunds(pool,config,query,()=>now+40001)).examined,0);assert.equal(calls,1);
  const [[stored]]=await pool.execute('SELECT status,submission_started_at FROM order_refunds WHERE id=?',[refund.id]);
  assert.equal(stored.status,'SUBMITTING');assert.equal(Number(stored.submission_started_at),now+400);
  assert.deepEqual(await reconcileRefunds({},{}),{enabled:false});
});
test('fund audit detects balanced but wrong shares, missing refund records and projection drift without repairs', async () => {
  const { auditPaymentFunds } = require('../cloudfunctions/payment-api/fund-audit');
  const refund = await seedApprovedRefund();
  await claimRefund(pool,refund.id,refundConfig,now+400);
  await recordRefundResult(pool,refundReceipt(refund),now+600);
  assert.equal((await auditPaymentFunds(pool,refund.payment_id)).ok,true);
  await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen+1 WHERE journal_id=? AND account='PLATFORM_PENDING'",[`payment:${refund.payment_id}`]);
  await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen-1 WHERE journal_id=? AND account='PROVIDER_PENDING'",[`payment:${refund.payment_id}`]);
  let audit = await auditPaymentFunds(pool,refund.payment_id);
  assert.equal(audit.ok,false); assert.ok(audit.issues.some(row=>row.code==='POSTING_AMOUNT_MISMATCH'));
  assert.ok(!audit.issues.some(row=>row.code==='JOURNAL_UNBALANCED'));
  await pool.execute('UPDATE order_payments SET refunded_fen=0,platform_refunded_fen=0,provider_refunded_fen=0 WHERE id=?',[refund.payment_id]);
  await pool.execute('DELETE FROM order_refund_reversals WHERE refund_id=?',[refund.id]);
  audit = await auditPaymentFunds(pool,refund.payment_id);
  assert.ok(audit.issues.some(row=>row.code==='REFUND_TOTALS_MISMATCH'));
  assert.ok(audit.issues.some(row=>row.code==='REFUND_REVERSAL_MISSING_OR_MISMATCH'));
  const [[stored]] = await pool.execute('SELECT refunded_fen FROM order_payments WHERE id=?',[refund.payment_id]);
  assert.equal(Number(stored.refunded_fen),0);
});
test('fund audit rejects a second balanced payment journal instead of accepting duplicated income',async()=>{
  const {auditPaymentFunds}=require('../cloudfunctions/payment-api/fund-audit');
  const refund=await seedApprovedRefund(),original=`payment:${refund.payment_id}`,duplicate=`duplicate:${refund.payment_id}`;
  assert.equal((await auditPaymentFunds(pool,refund.payment_id)).ok,true);
  await pool.execute(`INSERT INTO fund_journals
    (id,event_type,payment_id,refund_id,reverses_journal_id,provider_id,currency,fee_rule_version,created_at)
    SELECT ?,event_type,payment_id,refund_id,reverses_journal_id,provider_id,currency,fee_rule_version,created_at
    FROM fund_journals WHERE id=?`,[duplicate,original]);
  await pool.execute(`INSERT INTO fund_postings(journal_id,account,direction,amount_fen)
    SELECT ?,account,direction,amount_fen FROM fund_postings WHERE journal_id=?`,[duplicate,original]);
  const audit=await auditPaymentFunds(pool,refund.payment_id);
  assert.equal(audit.ok,false);
  assert.ok(audit.issues.some(row=>row.code==='PAYMENT_JOURNAL_BINDING_MISMATCH'&&row.id===duplicate));
  assert.ok(!audit.issues.some(row=>row.code==='JOURNAL_UNBALANCED'));
});

test('refund list recovers lost submission IDs and paginates identical timestamps without duplication', async () => {
  const { listOrderRefunds } = require('../cloudfunctions/payment-api/refund-read');
  const input = await seedDirectRefundPayment();
  const ids = [];
  for (let i=0;i<25;i++) ids.push((await requestRefund(pool, { ...input, amountFen: 1,
    requestKey: `refund_page_${String(i).padStart(8,'0')}` }, 'test_platform', now+200)).id);
  const actor = { WX_OPENID:'test_openid', WX_APPID:'test_app' }, event = { action:'listRefunds', orderId:'order_1' };
  const first = await listOrderRefunds(pool,event,actor,refundConfig);
  assert.equal(first.records.length,20);assert.ok(first.nextCursor);
  const second = await listOrderRefunds(pool,{...event,cursor:first.nextCursor},actor,refundConfig);
  assert.equal(second.records.length,5);assert.equal(second.nextCursor,null);
  const seen = [...first.records,...second.records].map(row=>row.refundId);
  assert.equal(new Set(seen).size,25);assert.deepEqual(seen,[...ids].sort().reverse());
  assert.doesNotMatch(JSON.stringify(first),/reviewed_by|evidence_reference|transaction_id|platform_mchid/);
  assert.deepEqual(await listOrderRefunds(pool,event,{...actor,WX_OPENID:'test_provider_openid'},refundConfig),first);
  await assert.rejects(listOrderRefunds(pool,event,{...actor,WX_OPENID:'foreign_openid'},refundConfig),code('ORDER_NOT_FOUND'));
  await assert.rejects(listOrderRefunds(pool,{...event,cursor:{createdAt:now,id:'bad'}},actor,refundConfig),code('REFUND_INPUT_INVALID'));
});
test('refund progress remains readable after applications close and follows persisted success', async () => {
  const refund = await seedApprovedRefund();
  const event = { action: 'getRefund', refundId: refund.id }, actor = { WX_OPENID: 'test_openid', WX_APPID: 'test_app' };
  const config = { ...refundConfig, refundRequestsEnabled: false };
  const approved = await readRefundRequest(pool, event, actor, config);
  assert.equal(approved.status, 'APPROVED'); assert.equal(approved.succeededAt, null);
  assert.deepEqual(Object.keys(approved).sort(), ['refundId','orderId','amountFen','status','createdAt','updatedAt','succeededAt'].sort());
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  await recordRefundResult(pool, refundReceipt(refund), now + 600);
  const completed = await readRefundRequest(pool, event, actor, config);
  assert.equal(completed.status, 'SUCCESS'); assert.equal(completed.succeededAt, now + 500);
});
test('refund progress does not expose another buyer or another merchant refund', async () => {
  const refund = await seedApprovedRefund();
  const event = { action: 'getRefund', refundId: refund.id }, actor = { WX_OPENID: 'test_openid', WX_APPID: 'test_app' };
  assert.deepEqual(await readRefundRequest(pool,event,{...actor,WX_OPENID:'test_provider_openid'},refundConfig),await readRefundRequest(pool,event,actor,refundConfig));
  await assert.rejects(readRefundRequest(pool, event, { ...actor, WX_OPENID: 'foreign_openid' }, refundConfig), code('REFUND_NOT_FOUND'));
  await assert.rejects(readRefundRequest(pool, event, actor, { ...refundConfig, platformMchid: 'other' }), code('REFUND_NOT_FOUND'));
  await assert.rejects(readRefundRequest(pool, { ...event, buyerId: 'buyer' }, actor, refundConfig), code('REFUND_INPUT_INVALID'));
  await assert.rejects(readRefundRequest(pool, event, { ...actor, WX_APPID: 'other' }, refundConfig), code('AUTH_CONTEXT_MISSING'));
});

test('lost refund response can be recovered by original request identity after applications close', async () => {
  const refund = await seedApprovedRefund();
  const [[stored]] = await pool.execute('SELECT order_id,payment_id,request_key FROM order_refunds WHERE id=?',[refund.id]);
  const event={action:'getRefund',orderId:stored.order_id,paymentId:stored.payment_id,requestKey:stored.request_key};
  const actor={WX_OPENID:'test_openid',WX_APPID:'test_app'}, config={...refundConfig,refundRequestsEnabled:false};
  assert.equal((await readRefundRequest(pool,event,actor,config)).refundId,refund.id);
  for (const altered of [{requestKey:'missing_request_00001'},{paymentId:'f'.repeat(32)},{orderId:'other'}])
    await assert.rejects(readRefundRequest(pool,{...event,...altered},actor,config),code('REFUND_NOT_FOUND'));
  await assert.rejects(readRefundRequest(pool,event,{...actor,WX_OPENID:'test_provider_openid'},config),code('REFUND_NOT_FOUND'));
  await assert.rejects(readRefundRequest(pool,event,actor,{...config,platformMchid:'other'}),code('REFUND_NOT_FOUND'));
  await assert.rejects(readRefundRequest(pool,{...event,refundId:refund.id},actor,config),code('REFUND_INPUT_INVALID'));
});
test('buyer refund entry resolves trusted account and repeated submissions remain pending review', async () => {
  const input = await seedDirectRefundPayment();
  const { buyerId, ...fields } = input;
  const event = { action: 'requestRefund', ...fields };
  const actor = { WX_OPENID: 'test_openid', WX_APPID: 'test_app' };
  const config = { appid: 'test_app', platformMchid: 'test_platform', refundRequestsEnabled: true };
  const replies = await Promise.all(Array.from({ length: 5 }, () => createRefundRequest(pool, event, actor, config, () => now + 200)));
  assert.equal(new Set(replies.map(row => row.refundId)).size, 1);
  assert.ok(replies.every(row => row.status === 'REQUESTED'));
  assert.deepEqual(Object.keys(replies[0]).sort(), ['refundId','orderId','amountFen','status','createdAt','updatedAt'].sort());
  const [[stored]] = await pool.execute('SELECT review_decision,submission_started_at FROM order_refunds WHERE id=?', [replies[0].refundId]);
  assert.equal(stored.review_decision, null); assert.equal(stored.submission_started_at, null);
});
test('refund entry rejects forged authority, foreign payer and disabled entry without writes', async () => {
  const { buyerId, ...fields } = await seedDirectRefundPayment();
  const event = { action: 'requestRefund', ...fields }, actor = { WX_OPENID: 'test_openid', WX_APPID: 'test_app' };
  const config = { appid: 'test_app', platformMchid: 'test_platform', refundRequestsEnabled: true };
  for (const patch of [{ buyerId: 'buyer' }, { status: 'APPROVED' }, { refundRequestsEnabled: true }, { amountFen: 1.5 }]) {
    await assert.rejects(createRefundRequest(pool, { ...event, ...patch }, actor, config), code('REFUND_INPUT_INVALID'));
  }
  await assert.rejects(createRefundRequest(pool, event, { ...actor, WX_APPID: 'foreign' }, config), code('AUTH_CONTEXT_MISSING'));
  await assert.rejects(createRefundRequest(pool, event, actor, { ...config, refundRequestsEnabled: false }), code('REFUND_REQUEST_NOT_ENABLED'));
  await pool.execute("INSERT INTO account_roles VALUES ('provider','BUYER',1)");
  try {
    await assert.rejects(createRefundRequest(pool, event, { ...actor, WX_OPENID: 'test_provider_openid' }, config), code('ORDER_NOT_FOUND'));
  } finally { await pool.execute("DELETE FROM account_roles WHERE account_id='provider' AND role='BUYER'"); }
  await assert.rejects(createRefundRequest(pool, { ...event, amountFen: 10001 }, actor, config), code('REFUND_AMOUNT_EXCEEDED'));
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refunds');
  assert.equal(Number(count.n), 0);
});
test('payment ledger failure rolls back receipt and order instead of leaving unrecorded income', async () => {
  const p = await reservePayment(pool, input({ paymentMode: 'DIRECT', fee: undefined, feeRuleVersion: 'PLATFORM_20_PERCENT_V1' }), now);
  await pool.query("CREATE TRIGGER fail_fund_posting BEFORE INSERT ON fund_postings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected ledger failure'");
  try {
    await assert.rejects(recordPaymentSuccess(pool, result(p, { paymentMode: 'DIRECT' }), now + 100), /injected ledger failure/);
    const [[stored]] = await pool.execute('SELECT status,transaction_id FROM order_payments WHERE id=?', [p.id]);
    const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM fund_journals');
    assert.equal(stored.status, 'CREATED'); assert.equal(stored.transaction_id, null); assert.equal(Number(count.n), 0);
    assert.equal((await order()).version, 1);
  } finally { await pool.query('DROP TRIGGER fail_fund_posting'); }
  await recordPaymentSuccess(pool, result(p, { paymentMode: 'DIRECT' }), now + 200);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM fund_journals');
  assert.equal(Number(count.n), 1);
});
const { handleRefundHttp } = require('../cloudfunctions/payment-api/payment-http');
function refundHttpEvent(refund, patch = {}, eventType = 'REFUND.SUCCESS') {
  const raw = notificationFixture.notify({ mchid: refund.platform_mchid, out_refund_no: refund.id,
    out_trade_no: refund.payment_id, transaction_id: refund.transaction_id, refund_id: `wx_${refund.id.slice(0,20)}`,
    refund_status: 'SUCCESS', success_time: new Date(now + 500).toISOString(),
    amount: { total: Number(refund.total_fen), refund: Number(refund.amount_fen), payer_total: Number(refund.total_fen), payer_refund: Number(refund.amount_fen) },
    ...patch }, now + 600, { event_type: eventType }, 'refund');
  return { httpMethod: 'POST', headers: raw.headers, body: raw.body.toString('utf8') };
}
test('encrypted refund HTTP notification commits success and acknowledges duplicate delivery', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  const config = { ...notificationFixture.config, ...refundConfig };
  const event = refundHttpEvent(refund);
  for (let i = 0; i < 2; i++) assert.equal((await handleRefundHttp(pool, event, config, now + 600, () => {})).statusCode, 204);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refund_reversals');
  assert.equal(Number(count.n), 1);
  const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'SUCCESS');
});
test('forged, foreign and mismatched refund notifications never acknowledge or change funds', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  const config = { ...notificationFixture.config, ...refundConfig };
  const valid = refundHttpEvent(refund);
  assert.equal((await handleRefundHttp(pool, { ...valid, body: valid.body + ' ' }, config, now + 600, () => {})).statusCode, 403);
  for (const event of [refundHttpEvent(refund, { mchid: 'other' }), refundHttpEvent(refund, { out_trade_no: 'b'.repeat(32) }),
    refundHttpEvent(refund, { amount: { total: 10000, refund: 1 } }), refundHttpEvent(refund, {}, 'REFUND.CLOSED')]) {
    assert.equal((await handleRefundHttp(pool, event, config, now + 600, () => {})).statusCode, 500);
  }
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refund_reversals');
  const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(Number(count.n), 0); assert.equal(stored.status, 'SUBMITTING');
});
test('partial refunds cumulatively reverse the full original platform and provider shares', async () => {
  const first = await seedApprovedRefund(3001);
  await claimRefund(pool, first.id, refundConfig, now + 400);
  await recordRefundResult(pool, refundReceipt(first), now + 600);
  const second = await requestRefund(pool, { orderId: first.order_id, paymentId: first.payment_id, buyerId: 'buyer',
    requestKey: 'refund_request_0002', amountFen: 6999, reason: '退还余款' }, 'test_platform', now + 700);
  await reviewRefund(pool, reviewInput(second.id), now + 800);
  assert.equal((await claimRefund(pool, second.id, refundConfig, now + 70000)).status, 'CLAIMED');
  await recordRefundResult(pool, refundReceipt(second, { succeededAt: now + 71000 }), now + 72000);
  const [[sums]] = await pool.execute('SELECT SUM(refund_fen) AS total,SUM(platform_reversal_fen) AS platform,SUM(provider_reversal_fen) AS provider,MAX(cumulative_refund_fen) AS cumulative FROM order_refund_reversals');
  assert.equal(Number(sums.total), 10000); assert.equal(Number(sums.platform), 2000);
  assert.equal(Number(sums.provider), 8000); assert.equal(Number(sums.cumulative), 10000);
  const [balances] = await pool.execute("SELECT account,SUM(IF(direction='DEBIT',amount_fen,-CAST(amount_fen AS SIGNED))) AS net FROM fund_postings GROUP BY account");
  assert.equal(balances.length, 3); assert.ok(balances.every(row => Number(row.net) === 0));
  const [journals] = await pool.execute("SELECT journal_id,SUM(IF(direction='DEBIT',amount_fen,-CAST(amount_fen AS SIGNED))) AS net FROM fund_postings GROUP BY journal_id");
  assert.equal(journals.length, 3); assert.ok(journals.every(row => Number(row.net) === 0));
  const [[projection]] = await pool.execute('SELECT refunded_fen,platform_refunded_fen,provider_refunded_fen FROM order_payments WHERE id=?', [first.payment_id]);
  assert.deepEqual(Object.values(projection).map(Number), [10000, 2000, 8000]);
});
test('failure after reversal insertion rolls the reversal and status back together', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  await pool.query("CREATE TRIGGER fail_refund_success BEFORE UPDATE ON order_refunds FOR EACH ROW BEGIN IF NEW.status='SUCCESS' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected persistence failure'; END IF; END");
  try {
    await assert.rejects(recordRefundResult(pool, refundReceipt(refund), now + 600), /injected persistence failure/);
    const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
    const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refund_reversals');
    assert.equal(stored.status, 'SUBMITTING'); assert.equal(Number(count.n), 0);
    const [[ledger]] = await pool.execute("SELECT COUNT(*) AS n FROM fund_journals WHERE event_type='REFUND_SUCCEEDED'");
    assert.equal(Number(ledger.n), 0);
    const [[projection]] = await pool.execute('SELECT refunded_fen FROM order_payments WHERE id=?', [refund.payment_id]);
    assert.equal(Number(projection.refunded_fen), 0);
  } finally { await pool.query('DROP TRIGGER fail_refund_success'); }
});
function refundReceipt(refund, patch = {}) {
  return { refundId: refund.id, channelRefundId: `channel_${refund.id}`, status: 'SUCCESS',
    amountFen: Number(refund.amount_fen), succeededAt: now + 500, ...patch };
}
test('concurrent success receipts record one reversal and late processing cannot regress success', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  const receipt = refundReceipt(refund);
  const results = await Promise.all(Array.from({ length: 10 }, () => recordRefundResult(pool, receipt, now + 600)));
  assert.ok(results.every(row => row.status === 'SUCCESS'));
  const [[reversal]] = await pool.execute('SELECT COUNT(*) AS n,SUM(platform_reversal_fen) AS platform,SUM(provider_reversal_fen) AS provider FROM order_refund_reversals');
  assert.equal(Number(reversal.n), 1); assert.equal(Number(reversal.platform), 600); assert.equal(Number(reversal.provider), 2400);
  assert.equal((await recordRefundResult(pool, refundReceipt(refund, { status: 'PROCESSING', succeededAt: null }), now + 700)).status, 'SUCCESS');
  await assert.rejects(recordRefundResult(pool, refundReceipt(refund, { status: 'CLOSED', succeededAt: null }), now + 700), code('REFUND_RESULT_CONFLICT'));
  const [[hold]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'REFUND_REQUEST');
});
test('mismatched refund result leaves both refund state and reversal untouched', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  await assert.rejects(recordRefundResult(pool, refundReceipt(refund, { amountFen: 3001 }), now + 600), code('REFUND_RESULT_MISMATCH'));
  const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM order_refund_reversals');
  assert.equal(stored.status, 'SUBMITTING'); assert.equal(Number(count.n), 0);
});
test('unknown submission recovers by querying the same refund without submitting again', async () => {
  const refund = await seedApprovedRefund();
  let submissions = 0, queries = 0;
  await assert.rejects(executeRefund(pool, refund.id, refundConfig, async () => { submissions++; throw Error('timeout'); }, () => now + 400), /timeout/);
  const config = { ...refundConfig, refundReconciliationEnabled: true };
  const channel = async row => { queries++; assert.equal(row.id, refund.id); return refundReceipt(refund); };
  assert.equal((await refreshRefund(pool, refund.id, config, channel, () => now + 500)).status, 'BUSY');
  await assert.rejects(refreshRefund(pool, refund.id, config, async () => { throw Error('query timeout'); }, () => now + 40000), /query timeout/);
  const [[stored]] = await pool.execute('SELECT status FROM order_refunds WHERE id=?', [refund.id]);
  assert.equal(stored.status, 'SUBMITTING');
  assert.equal((await refreshRefund(pool, refund.id, config, channel, () => now + 40001)).status, 'SUCCESS');
  assert.equal(submissions, 1); assert.equal(queries, 1);
});
test('closed refund releases only a refund hold and never a dispute', async () => {
  const refund = await seedApprovedRefund();
  await claimRefund(pool, refund.id, refundConfig, now + 400);
  await require('../cloudfunctions/payment-api/funds-interlock').holdOrderFunds(pool, 'order_1', 'DISPUTE', now + 450);
  await recordRefundResult(pool, refundReceipt(refund, { status: 'CLOSED', succeededAt: null }), now + 600);
  const [[hold]] = await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?', ['order_1']);
  assert.equal(hold.hold_reason, 'DISPUTE');
});

test('provider refund visibility follows order membership and active role', async () => {
  const { listOrderRefunds } = require('../cloudfunctions/payment-api/refund-read');
  const refund = await seedApprovedRefund();
  const actor = { WX_OPENID:'test_provider_openid', WX_APPID:'test_app' };
  const event = { action:'getRefund', refundId:refund.id }, list = { action:'listRefunds', orderId:'order_1' };
  await assert.rejects(readRefundRequest(pool,event,actor,{...refundConfig,platformMchid:'foreign'}),code('REFUND_NOT_FOUND'));
  assert.equal((await listOrderRefunds(pool,list,actor,{...refundConfig,platformMchid:'foreign'})).records.length,0);
  await pool.execute("UPDATE order_aggregates SET provider_id='buyer' WHERE id='order_1'");
  await assert.rejects(readRefundRequest(pool,event,actor,refundConfig),code('REFUND_NOT_FOUND'));
  await assert.rejects(listOrderRefunds(pool,list,actor,refundConfig),code('ORDER_NOT_FOUND'));
  await pool.execute("UPDATE order_aggregates SET provider_id='provider' WHERE id='order_1'");
  await pool.execute("DELETE FROM account_roles WHERE account_id='provider' AND role='PROVIDER'");
  try {
    await assert.rejects(readRefundRequest(pool,event,actor,refundConfig),code('REFUND_NOT_FOUND'));
    await assert.rejects(listOrderRefunds(pool,list,actor,refundConfig),code('ORDER_NOT_FOUND'));
  } finally { await pool.execute("INSERT INTO account_roles VALUES ('provider','PROVIDER',1)"); }
  await pool.execute("UPDATE accounts SET status='SUSPENDED' WHERE id='provider'");
  try {
    await assert.rejects(readRefundRequest(pool,event,actor,refundConfig),code('REFUND_NOT_FOUND'));
    await assert.rejects(listOrderRefunds(pool,list,actor,refundConfig),code('ORDER_NOT_FOUND'));
  } finally { await pool.execute("UPDATE accounts SET status='ACTIVE' WHERE id='provider'"); }
});

test('fund audit independently detects mutually consistent but incorrect refund shares and cumulative totals', async () => {
  const { auditPaymentFunds } = require('../cloudfunctions/payment-api/fund-audit');
  const refund=await seedApprovedRefund();await claimRefund(pool,refund.id,refundConfig,now+400);
  await recordRefundResult(pool,refundReceipt(refund),now+600);
  assert.equal((await auditPaymentFunds(pool,refund.payment_id)).ok,true);
  await pool.execute('UPDATE order_refund_reversals SET platform_reversal_fen=platform_reversal_fen+1,provider_reversal_fen=provider_reversal_fen-1 WHERE refund_id=?',[refund.id]);
  await pool.execute('UPDATE order_payments SET platform_refunded_fen=platform_refunded_fen+1,provider_refunded_fen=provider_refunded_fen-1 WHERE id=?',[refund.payment_id]);
  await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen+1 WHERE journal_id=? AND account='PLATFORM_PENDING'",[`refund:${refund.id}`]);
  await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen-1 WHERE journal_id=? AND account='PROVIDER_PENDING'",[`refund:${refund.id}`]);
  const audit=await auditPaymentFunds(pool,refund.payment_id);
  assert.equal(audit.ok,false);assert.deepEqual(audit.issues,[{code:'REFUND_ALLOCATION_MISMATCH',id:refund.id}]);
  await pool.execute('UPDATE order_refund_reversals SET platform_reversal_fen=platform_reversal_fen-1,provider_reversal_fen=provider_reversal_fen+1,cumulative_refund_fen=cumulative_refund_fen+1 WHERE refund_id=?',[refund.id]);
  assert.ok((await auditPaymentFunds(pool,refund.payment_id)).issues.some(row=>row.code==='REFUND_ALLOCATION_MISMATCH'));
  const [[stored]]=await pool.execute('SELECT cumulative_refund_fen,refund_fen FROM order_refund_reversals WHERE refund_id=?',[refund.id]);
  assert.equal(Number(stored.cumulative_refund_fen),Number(stored.refund_fen)+1);
});

test('operator fund audit limits the snapshot to its merchant AppID and DIRECT mode',async()=>{
  const { auditOperatorPayment }=require('../cloudfunctions/payment-api/fund-audit');
  const refund=await seedApprovedRefund();
  const settings={appid:'test_app',platformMchid:'test_platform'};
  assert.equal((await auditOperatorPayment(pool,refund.payment_id,settings)).ok,true);
  for(const config of [{}, {...settings,appid:'other'},{...settings,platformMchid:'other'}]) {
    await assert.rejects(auditOperatorPayment(pool,refund.payment_id,config),/FUND_AUDIT_SCOPE_REQUIRED|PAYMENT_NOT_FOUND/);
  }
  await pool.execute("UPDATE order_payments SET payment_mode='COMBINE',sub_mchid='test_sub' WHERE id=?",[refund.payment_id]);
  await assert.rejects(auditOperatorPayment(pool,refund.payment_id,settings),/PAYMENT_NOT_FOUND/);
});

test('net audit detects balanced wrong shares and missing sources',async()=>{
  const {postFinanceNet}=require('../cloudfunctions/payment-api/fund-ledger');
  const {auditPaymentFunds}=require('../cloudfunctions/payment-api/fund-audit');
  const f=await netFixture(),connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const {journalId}=await postFinanceNet(connection,f.payment,f.importId,f.hash,f.row,'finance',now+200);
    await connection.commit();
    assert.equal((await auditPaymentFunds(pool,f.payment.id)).ok,true);
    await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen+1 WHERE journal_id=? AND account='PROVIDER_NET'",[journalId]);
    await pool.execute("UPDATE fund_postings SET amount_fen=amount_fen-1 WHERE journal_id=? AND account='INCOME_TAX_PAYABLE'",[journalId]);
    const report=await auditPaymentFunds(pool,f.payment.id);
    assert.ok(report.issues.some(r=>r.code==='NET_POSTING_MISMATCH'));
    assert.ok(!report.issues.some(r=>r.code==='JOURNAL_UNBALANCED'));
    await pool.execute('UPDATE finance_result_imports SET appid=? WHERE id=?',['other',f.importId]);
    assert.ok((await auditPaymentFunds(pool,f.payment.id)).issues.some(r=>r.code==='NET_SOURCE_BINDING_MISMATCH'));
    await pool.execute("UPDATE fund_journals SET event_type='PAYMENT_CONFIRMED' WHERE id=?",[journalId]);
    assert.ok((await auditPaymentFunds(pool,f.payment.id)).issues.some(r=>r.code==='NET_JOURNAL_MISSING'));
    await pool.execute("UPDATE fund_journals SET event_type='FINANCE_NET_APPROVED' WHERE id=?",[journalId]);
    await pool.execute('DELETE FROM finance_net_settlements WHERE payment_id=?',[f.payment.id]);
    assert.ok((await auditPaymentFunds(pool,f.payment.id)).issues.some(r=>r.code==='NET_SOURCE_MISSING'));
  }finally{await connection.rollback();connection.release();}
});

test('finance approval concurrent retries credit once and cancelled batches cannot credit',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const {snapshotHash}=require('../scripts/finance-tax-result-review');
  const {saveFinanceResult}=require('../scripts/finance-tax-result-store');
  const {approveFinanceResult}=require('../scripts/finance-result-approve-store');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid,operatorId:'finance'};
  async function prepare(payment,key){
    const batch=await reserveBankBatch(pool,{paymentIds:[payment.id],operatorId:'finance',requestKey:key},scope,now+300);
    const review=await readBankBatchReview(pool,batch.batchId,scope);
    const input={resultId:key,batchId:batch.batchId,sourceSha256:snapshotHash(review),evidenceReference:'manual-fixture',records:review.records.map(r=>({paymentId:r.paymentId,orderId:r.orderId,providerId:r.providerId,taxPeriod:'2026-09',basisReference:'test',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}))};
    return {batch,imported:await saveFinanceResult(pool,scope,review,input,'finance')};
  }
  const first=await prepare(p,'net_approval_test_0001');
  const outcomes=await Promise.all(Array.from({length:20},()=>approveFinanceResult(pool,first.imported.id,scope,now+400)));
  assert.equal(outcomes.filter(r=>!r.alreadyRecorded).length,1);
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM finance_net_settlements WHERE payment_id=?',[p.id]);
  assert.equal(Number(count.n),1);
  const other=await prepare(await bankSource('order_2'),'net_approval_test_0002');
  await cancelBankBatch(pool,{batchId:other.batch.batchId,operatorId:'finance',reason:'test'},scope,now+400);
  await assert.rejects(approveFinanceResult(pool,other.imported.id,scope,now+500),/FINANCE_LIVE_SOURCE_NOT_READY/);
});

test('finance approval different results cannot double credit and a late batch failure rolls everything back',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const {snapshotHash}=require('../scripts/finance-tax-result-review');
  const {saveFinanceResult}=require('../scripts/finance-tax-result-store');
  const {approveFinanceResult}=require('../scripts/finance-result-approve-store');
  const first=await bankSource(),second=await bankSource('order_2');
  const scope={appid:first.appid,platformMchid:first.platform_mchid,operatorId:'finance'};
  const batch=await reserveBankBatch(pool,{paymentIds:[first.id,second.id],operatorId:'finance',requestKey:'net_atomic_batch_0001'},scope,now+300);
  const review=await readBankBatchReview(pool,batch.batchId,scope);
  const input={resultId:'net_result_a',batchId:batch.batchId,sourceSha256:snapshotHash(review),evidenceReference:'test',records:review.records.map(r=>({paymentId:r.paymentId,orderId:r.orderId,providerId:r.providerId,taxPeriod:'2026-09',basisReference:'test',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}))};
  const a=await saveFinanceResult(pool,scope,review,input,'finance');
  const b=await saveFinanceResult(pool,scope,review,{...input,resultId:'net_result_b'},'finance');
  let writes=0;
  const failingPool={execute:pool.execute.bind(pool),async getConnection(){
    const connection=await pool.getConnection();
    return new Proxy(connection,{get(target,key){
      if(key==='execute')return async(sql,args)=>{if(sql.includes('INSERT INTO finance_net_settlements')&&++writes===2)throw Error('TEST_SECOND_WRITE_FAILED');return target.execute(sql,args);};
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
  }};
  await assert.rejects(approveFinanceResult(failingPool,a.id,scope,now+400),/TEST_SECOND_WRITE_FAILED/);
  const [[sources]]=await pool.query('SELECT COUNT(*) AS n FROM finance_net_settlements');assert.equal(Number(sources.n),0);
  const [[journals]]=await pool.query("SELECT COUNT(*) AS n FROM fund_journals WHERE event_type='FINANCE_NET_APPROVED'");assert.equal(Number(journals.n),0);
  const results=await Promise.allSettled([a,b].map(r=>approveFinanceResult(pool,r.id,scope,now+500)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/FINANCE_APPROVAL_CONFLICT/);
  const [stored]=await pool.query('SELECT import_id FROM finance_net_settlements');assert.equal(stored.length,2);assert.equal(new Set(stored.map(r=>r.import_id)).size,1);
});

test('finance approval waits for an earlier dispute lock then refuses stale net credit',async()=>{
  const {reserveBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const {snapshotHash}=require('../scripts/finance-tax-result-review');
  const {saveFinanceResult}=require('../scripts/finance-tax-result-store');
  const {approveFinanceResult}=require('../scripts/finance-result-approve-store');
  const {holdOrderFunds}=require('../cloudfunctions/payment-api/funds-interlock');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid,operatorId:'finance'};
  const batch=await reserveBankBatch(pool,{paymentIds:[p.id],operatorId:'finance',requestKey:'net_dispute_race_0001'},scope,now+300);
  const review=await readBankBatchReview(pool,batch.batchId,scope);
  const imported=await saveFinanceResult(pool,scope,review,{resultId:'race',batchId:batch.batchId,sourceSha256:snapshotHash(review),evidenceReference:'test',records:[{paymentId:p.id,orderId:p.order_id,providerId:'provider',taxPeriod:'2026-09',basisReference:'test',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]},'finance');
  let held,release,attempted;
  const holdReady=new Promise(r=>held=r),holdGate=new Promise(r=>release=r),approvalAttempt=new Promise(r=>attempted=r);
  function wrapped(mode){return {execute:pool.execute.bind(pool),async getConnection(){const c=await pool.getConnection();return new Proxy(c,{get(t,k){
    if(mode==='hold'&&k==='commit')return async()=>{held();await holdGate;return t.commit();};
    if(mode==='approve'&&k==='execute')return async(sql,args)=>{if(sql.includes('FROM order_aggregates')&&sql.includes('FOR UPDATE'))attempted();return t.execute(sql,args);};
    const v=t[k];return typeof v==='function'?v.bind(t):v;
  }});}};}
  const hold=holdOrderFunds(wrapped('hold'),p.order_id,'DISPUTE',now+400);
  let approval;
  try{
    await holdReady;
    approval=assert.rejects(approveFinanceResult(wrapped('approve'),imported.id,scope,now+500),/FINANCE_LIVE_SOURCE_NOT_READY/);
    await approvalAttempt;release();await hold;await approval;
    const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM finance_net_settlements');assert.equal(Number(count.n),0);
    const [[state]]=await pool.execute('SELECT hold_reason FROM order_funds_interlocks WHERE order_id=?',[p.order_id]);assert.equal(state.hold_reason,'DISPUTE');
  }finally{release();await hold;if(approval)await approval;}
});

test('approved finance sources survive cancellation and lost commit responses without duplicate credit',async()=>{
  const {reserveBankBatch,cancelBankBatch}=require('../cloudfunctions/payment-api/bank-settlement-store');
  const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
  const {snapshotHash}=require('../scripts/finance-tax-result-review');
  const {saveFinanceResult}=require('../scripts/finance-tax-result-store');
  const {approveFinanceResult}=require('../scripts/finance-result-approve-store');
  const {holdOrderFunds}=require('../cloudfunctions/payment-api/funds-interlock');
  const p=await bankSource(),scope={appid:p.appid,platformMchid:p.platform_mchid,operatorId:'finance'};
  const batch=await reserveBankBatch(pool,{paymentIds:[p.id],operatorId:'finance',requestKey:'net_commit_recovery_0001'},scope,now+300);
  const review=await readBankBatchReview(pool,batch.batchId,scope);
  const imported=await saveFinanceResult(pool,scope,review,{resultId:'commit_recovery',batchId:batch.batchId,sourceSha256:snapshotHash(review),evidenceReference:'test',records:[{paymentId:p.id,orderId:p.order_id,providerId:'provider',taxPeriod:'2026-09',basisReference:'test',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]},'finance');
  const lostResponsePool={execute:pool.execute.bind(pool),async getConnection(){const c=await pool.getConnection();return new Proxy(c,{get(t,k){
    if(k==='commit')return async()=>{await t.commit();throw Error('TEST_COMMIT_RESPONSE_LOST');};
    const v=t[k];return typeof v==='function'?v.bind(t):v;
  }});}};
  await assert.rejects(approveFinanceResult(lostResponsePool,imported.id,scope,now+400),/TEST_COMMIT_RESPONSE_LOST/);
  assert.equal((await approveFinanceResult(pool,imported.id,scope,now+500)).alreadyRecorded,true);
  await assert.rejects(cancelBankBatch(pool,{batchId:batch.batchId,operatorId:'finance',reason:'test'},scope,now+600),code('BANK_BATCH_NET_ALREADY_RECORDED'));
  const [[source]]=await pool.execute('SELECT released_at FROM bank_settlement_sources WHERE batch_id=?',[batch.batchId]);assert.equal(source.released_at,null);
  const [[stored]]=await pool.execute('SELECT status FROM bank_settlement_batches WHERE id=?',[batch.batchId]);assert.equal(stored.status,'RESERVED_DRAFT');
  await holdOrderFunds(pool,p.order_id,'DISPUTE',now+700);
  const heldReview=await readBankBatchReview(pool,batch.batchId,scope);
  assert.equal(heldReview.sourcesUnchanged,false);assert.equal(heldReview.payable,false);
  await assert.rejects(approveFinanceResult(pool,imported.id,scope,now+800),/FINANCE_LIVE_SOURCE_NOT_READY/);
  const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM finance_net_settlements');assert.equal(Number(count.n),1);
});

test('private reference downloads enforce real database identity, NDA and current asset state before signing', async () => {
  const assetId = 'asset_' + crypto.randomBytes(16).toString('hex');
  const fileId = 'cloud://cloudbase-d2g65rqbvee0bd978.fixture/user-uploads/buyer/project_reference/' + assetId + '.png';
  await pool.execute(`INSERT INTO media_assets(id,owner_account_id,storage_key,mime_type,size_bytes,status,purpose,created_at)
    VALUES(?,'buyer',?,'image/png',10,'READY','PROJECT_REFERENCE',1)`, [assetId, fileId]);
  await pool.query("INSERT INTO accounts(id,uid,nickname,created_at,updated_at) VALUES('media_outsider','media_outsider','TEST',1,1)");
  await pool.query("INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES('media_outsider','media_outsider_openid',1,1)");
  const row = await order(), payload = row.payload;
  payload.public.referenceAssetId = assetId; payload.public.ndaRequired = true;
  payload.public.buyerNdaSigned = false; payload.public.providerNdaSigned = false;
  await pool.execute('UPDATE order_aggregates SET payload=? WHERE id=?', [JSON.stringify(payload), row.id]);
  let issued = 0;
  const storage = { async getTempFileURL(request) {
    assert.deepEqual(request, { fileList: [{ fileID: fileId, maxAge: 300 }] }); issued++;
    return { fileList: [{ fileID: fileId, code: 'SUCCESS', tempFileURL: 'https://files.example.test/reference' }] };
  } };
  const download = openId => handleOrder(databaseReader(), { action: 'getReferenceDownload', orderId: row.id,
    assetId: 'ignored-client-asset', providerId: 'buyer' }, { WX_OPENID: openId }, contactKey, now, undefined, storage);
  await download('test_openid');
  await assert.rejects(download('test_provider_openid'), code('NDA_REQUIRED'));
  await assert.rejects(download('media_outsider_openid'), code('ORDER_NOT_FOUND'));
  payload.public.buyerNdaSigned = true; payload.public.providerNdaSigned = true;
  await pool.execute('UPDATE order_aggregates SET payload=? WHERE id=?', [JSON.stringify(payload), row.id]);
  await download('test_provider_openid');
  await pool.query("UPDATE accounts SET status='SUSPENDED' WHERE id='provider'");
  try { await assert.rejects(download('test_provider_openid'), code('ACCOUNT_NOT_FOUND')); }
  finally { await pool.query("UPDATE accounts SET status='ACTIVE' WHERE id='provider'"); }
  await pool.execute("UPDATE media_assets SET status='DELETED' WHERE id=?", [assetId]);
  for (const openId of ['test_openid', 'test_provider_openid']) {
    await assert.rejects(download(openId), code('REFERENCE_MEDIA_NOT_READY'));
  }
  assert.equal(issued, 2);
});

test('delivery downloads enforce real database order, owner, purpose and availability for both participants', async () => {
  const assetId = 'asset_' + crypto.randomBytes(16).toString('hex');
  const fileId = 'cloud://cloudbase-d2g65rqbvee0bd978.fixture/user-uploads/provider/order_delivery/order_1/' + assetId + '.pdf';
  await pool.execute(`INSERT INTO media_assets(id,owner_account_id,storage_key,mime_type,size_bytes,status,purpose,scope_id,created_at)
    VALUES(?,'provider',?,'application/pdf',10,'READY','ORDER_DELIVERY','order_1',1)`, [assetId, fileId]);
  const row = await order(), payload = row.payload;
  payload.public.deliveryFiles = [{ assetId, fileId, name: 'fixture.pdf' }];
  payload.public.ndaRequired = true; payload.public.buyerNdaSigned = true; payload.public.providerNdaSigned = true;
  await pool.execute("UPDATE order_aggregates SET stage='DELIVERY_PENDING',payload=? WHERE id=?", [JSON.stringify(payload), row.id]);
  let issued = 0;
  const storage = { async getTempFileURL(request) {
    assert.deepEqual(request, { fileList: [{ fileID: fileId, maxAge: 300 }] }); issued++;
    return { fileList: [{ fileID: fileId, code: 'SUCCESS', tempFileURL: 'https://files.example.test/delivery' }] };
  } };
  const download = openId => handleOrder(databaseReader(), { action: 'getDeliveryDownload', orderId: row.id, assetId },
    { WX_OPENID: openId }, contactKey, now, undefined, storage);
  for (const openId of ['test_openid', 'test_provider_openid']) await download(openId);
  // Independent outsider fixture: this test can run alone.
  const outsider = 'outsider_' + crypto.randomBytes(4).toString('hex');
  await pool.execute('INSERT INTO accounts(id,uid,nickname,created_at,updated_at) VALUES(?,?,?,1,1)', [outsider, outsider, 'TEST']);
  await pool.execute('INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES(?,?,1,1)', [outsider, outsider]);
  await assert.rejects(download(outsider), code('ORDER_NOT_FOUND'));
  for (const [column, invalid, original] of [['scope_id', 'other_order', 'order_1'], ['owner_account_id', 'buyer', 'provider'],
    ['purpose', 'PROJECT_REFERENCE', 'ORDER_DELIVERY'], ['status', 'REJECTED', 'READY']]) {
    await pool.execute(`UPDATE media_assets SET ${column}=? WHERE id=?`, [invalid, assetId]);
    for (const openId of ['test_openid', 'test_provider_openid']) await assert.rejects(download(openId), code('DELIVERY_FILE_INVALID'));
    await pool.execute(`UPDATE media_assets SET ${column}=? WHERE id=?`, [original, assetId]);
  }
  payload.public.providerNdaSigned = false;
  await pool.execute('UPDATE order_aggregates SET payload=? WHERE id=?', [JSON.stringify(payload), row.id]);
  await assert.rejects(download('test_openid'), code('NDA_REQUIRED'));
  await pool.execute("UPDATE order_aggregates SET stage='IN_PRODUCTION' WHERE id=?", [row.id]);
  await assert.rejects(download('test_provider_openid'), code('ILLEGAL_TRANSITION'));
  assert.equal(issued, 2, 'rejected reads must not invoke storage signing');
});
