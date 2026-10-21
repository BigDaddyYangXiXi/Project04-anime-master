const test=require('node:test'),assert=require('node:assert/strict');
const {recordRefundResult}=require('./refund-results');
const {VERSION}=require('./fee-policy');
function fixture(){
 const payment={id:'a'.repeat(32),order_id:'order',payment_mode:'DIRECT',status:'PAID',currency:'CNY',
  amount_fen:7,platform_fee_fen:1,fee_rule_version:VERSION,transaction_id:'transaction',platform_mchid:'merchant',
  refunded_fen:0,platform_refunded_fen:0,provider_refunded_fen:0};
 const refunds=[3,4].map((amount,i)=>({id:String(i+1).repeat(32),order_id:'order',payment_id:payment.id,
  review_decision:'APPROVE',submission_started_at:1,status:'PROCESSING',amount_fen:amount,
  transaction_id:payment.transaction_id,platform_mchid:payment.platform_mchid,total_fen:7,fee_rule_version:VERSION,platform_fee_fen:1}));
 let state={payment,refunds,journals:[],postings:[],reversals:[]},working,failure=false;
 const calls=[];
 const connection={
  async beginTransaction(){working=structuredClone(state);calls.push('begin');},
  async commit(){state=working;calls.push('commit');},async rollback(){working=null;calls.push('rollback');},release(){calls.push('release');},
  async execute(sql,args){
   if(sql.startsWith('SELECT id,provider_id FROM order_aggregates'))return [[{id:'order',provider_id:'provider'}]];
   if(sql.startsWith('SELECT * FROM order_payments'))return [[working.payment]];
   if(sql.startsWith('SELECT * FROM order_refunds WHERE order_id'))return [working.refunds];
   if(sql.startsWith('SELECT provider_id,payment_id FROM fund_journals'))return [[{provider_id:'provider',payment_id:payment.id}]];
   if(sql.startsWith('INSERT INTO fund_journals')){working.journals.push(args);return [{}];}
   if(sql.startsWith('INSERT INTO fund_postings')){working.postings.push(args);return [{}];}
   if(sql.startsWith('INSERT INTO order_refund_reversals')){
    if(failure)throw Error('injected reversal write failure');working.reversals.push(args);return [{}];
   }
   if(sql.startsWith('UPDATE order_payments SET refunded_fen')){[working.payment.refunded_fen,working.payment.platform_refunded_fen,working.payment.provider_refunded_fen]=args;return [{}];}
   if(sql.startsWith('UPDATE order_refunds SET status=')){
    const refund=working.refunds.find(r=>r.id===args[4]);Object.assign(refund,{status:args[0],channel_refund_id:args[1],succeeded_at:args[2]});return [{}];
   }
   if(sql.startsWith('SELECT * FROM order_refunds WHERE id='))return [[working.refunds.find(r=>r.id===args[0])]];
   if(sql.startsWith('SELECT refund_fen FROM order_refund_reversals')){const r=working.reversals.find(r=>r[0]===args[0]);return [r?[{refund_fen:r[2]}]:[]];}
   throw Error('unexpected SQL: '+sql);
  }
 };
 const pool={getConnection:async()=>connection,execute:async(sql,args)=>{
  assert.equal(sql,'SELECT order_id,payment_id FROM order_refunds WHERE id=?');assert(state.refunds.some(r=>r.id===args[0]));
  return [[{order_id:'order',payment_id:payment.id}]];
 }};
 return {pool,calls,state:()=>structuredClone(state),fail:v=>failure=v,
  receipt:i=>({refundId:refunds[i].id,channelRefundId:'channel_'+i,status:'SUCCESS',amountFen:refunds[i].amount_fen,succeededAt:100})};
}
test('partial refunds and duplicate callbacks retain exactly the original 20 percent split',async()=>{
 const f=fixture();await recordRefundResult(f.pool,f.receipt(0),100);
 assert.deepEqual([f.state().payment.refunded_fen,f.state().payment.platform_refunded_fen,f.state().payment.provider_refunded_fen],[3,0,3]);
 const first=f.state();await recordRefundResult(f.pool,f.receipt(0),101);assert.deepEqual(f.state(),first);
 await recordRefundResult(f.pool,f.receipt(1),102);const final=f.state();
 assert.deepEqual([final.payment.refunded_fen,final.payment.platform_refunded_fen,final.payment.provider_refunded_fen],[7,1,6]);
 assert.equal(final.journals.length,2);assert.equal(final.reversals.length,2);
 for(const journal of final.journals){const rows=final.postings.filter(r=>r[0]===journal[0]);
  assert.equal(rows.reduce((sum,r)=>sum+(r[2]==='DEBIT'?r[3]:-r[3]),0),0);}
 await recordRefundResult(f.pool,f.receipt(1),103);assert.deepEqual(f.state(),final);
});
test('failure after journal writes rolls back the entire result, and same refund retries once',async()=>{
 const f=fixture(),before=f.state();f.fail(true);
 await assert.rejects(recordRefundResult(f.pool,f.receipt(0),100),/injected reversal/);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.calls,['begin','rollback','release']);
 f.fail(false);await recordRefundResult(f.pool,f.receipt(0),101);assert.equal(f.state().journals.length,1);assert.equal(f.state().reversals.length,1);
});
test('conflicting final timestamp and mismatched amount cannot change a confirmed refund',async()=>{
 const f=fixture();await recordRefundResult(f.pool,f.receipt(0),100);const before=f.state();
 await assert.rejects(recordRefundResult(f.pool,{...f.receipt(0),succeededAt:101},101),{code:'REFUND_RESULT_CONFLICT'});
 await assert.rejects(recordRefundResult(f.pool,{...f.receipt(0),amountFen:4},101),{code:'REFUND_RESULT_MISMATCH'});
 assert.deepEqual(f.state(),before);
});
