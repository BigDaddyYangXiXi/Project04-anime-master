const test = require('node:test');
const assert = require('node:assert/strict');
const { readBankSettlementPreview } = require('./bank-settlement-preview');
const { operateRefund } = require('./refund-operator');
const { queryEvent } = require('../../scripts/refund-operator-console');
const id = 'a'.repeat(32), config = { appid:'wx_test',platformMchid:'123',refundOperatorEnabled:true };
function fixture(patch = {}, refunds = [], interlock = {hold_reason:null,settlement_task_id:null}) {
  const payment = {id,order_id:'order_1',provider_id:'provider_1',payment_mode:'DIRECT',status:'PAID',
    payer_verification:'MATCHED',currency:'CNY',received_currency:'CNY',amount_fen:'10000',received_total_fen:'10000',
    platform_fee_fen:'2000',fee_rule_version:'PLATFORM_20_PERCENT_V1',refunded_fen:'0',platform_refunded_fen:'0',provider_refunded_fen:'0',
    transaction_id:'txn',order_stage:'COMPLETED',current_order_version:'5',
    order_payload:{public:{paymentId:id,paymentStatus:'PAID',paymentTransactionId:'txn',amountFen:10000,completedAt:100},
      settlementIntent:{paymentId:id,status:'PENDING',acceptedOrderVersion:5,createdAt:100}},...patch};
  const events=[];
  const connection={async query(sql){events.push(sql);},async execute(sql,params){
    assert.match(sql,/^SELECT /);events.push('SELECT');
    if(sql.includes('FROM order_payments')) {assert.deepEqual(params,[id,'wx_test','123']);return [[payment]];}
    if(sql.includes('FROM order_refunds')) return [refunds];
    if(sql.includes('FROM order_funds_interlocks')) return [[interlock].filter(Boolean)];
    assert.fail('unexpected query');
  },async commit(){events.push('commit');},async rollback(){events.push('rollback');},release(){events.push('release');},destroy(){events.push('destroy');}};
  return {pool:{async getConnection(){return connection;}},events,connection,payment};
}
test('read-only coherent preview binds merchant and returns amounts, never authorizes payment',async()=>{
  const f=fixture();const result=await readBankSettlementPreview(f.pool,id,config);
  assert.equal(result.amounts.providerPretaxFen,8000);assert.equal(result.payable,false);
  assert.deepEqual(result.blockers,['LEDGER_AND_PRIOR_PAYOUT_CHECK_REQUIRED','BANK_ACCOUNT_AND_TAX_CHECK_REQUIRED']);
  assert.deepEqual(f.events.slice(0,2),['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ','START TRANSACTION READ ONLY']);
  assert.deepEqual(f.events.slice(-2),['commit','release']);
  assert.equal(result.transaction_id,undefined);assert.equal(result.order_payload,undefined);
});
test('unaccepted orders and unresolved or unknown refund states are blocked',async()=>{
  for(const status of ['REQUESTED','PROCESSING','UNKNOWN','UNRECOGNIZED']) {
    const f=fixture({order_stage:'IN_PROGRESS'},[{status}]);
    const result=await readBankSettlementPreview(f.pool,id,config);
    assert.ok(result.blockers.includes('ORDER_ACCEPTANCE_UNVERIFIED'));
    assert.ok(result.blockers.includes('REFUND_UNRESOLVED'));
  }
});
test('missing interlock, held funds and channel settlement are explicit blockers',async()=>{
  for(const [lock,expected] of [[null,'FUNDS_INTERLOCK_MISSING'],[{hold_reason:'DISPUTE'},'FUNDS_HELD'],
    [{settlement_task_id:id},'CHANNEL_SETTLEMENT_STARTED']]) {
    const result=await readBankSettlementPreview(fixture({},[],lock).pool,id,config);
    assert.ok(result.blockers.includes(expected));assert.equal(result.payable,false);
  }
});
test('failed database read rolls back and rollback failure discards connection',async()=>{
  const f=fixture();f.connection.execute=async()=>{throw Error('db');};
  f.connection.rollback=async()=>{throw Error('rollback');};
  await assert.rejects(readBankSettlementPreview(f.pool,id,config),/db/);
  assert.equal(f.events.at(-1),'destroy');
});
test('bank preview inherits operator identity and exact-input gates',async()=>{
  const token='b'.repeat(64),env={SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_OPERATOR_TOKEN:token,PAYMENT_REFUND_REVIEWER_ID:'operator'};
  const input={action:'bankPreview',paymentId:id,operatorToken:token};
  const forbidden=()=>assert.fail('must not access runtime');
  assert.equal((await operateRefund(input,{WX_OPENID:'user'},env,forbidden,{})).error.code,'REFUND_OPERATOR_FORBIDDEN');
  assert.equal((await operateRefund({...input,amountFen:1},{},env,forbidden,{})).error.code,'REFUND_OPERATOR_INPUT_INVALID');
  const result=await operateRefund(input,{},env,()=>({pool:{},config}),{bankPreview:async()=>({payable:false})});
  assert.deepEqual(result,{ok:true,data:{payable:false}});
  assert.deepEqual(queryEvent({action:'bankPreview',paymentId:id}),{action:'bankPreview',paymentId:id});
  assert.throws(()=>queryEvent({action:'bankPreview',paymentId:id,platformMchid:'other'}));
});
