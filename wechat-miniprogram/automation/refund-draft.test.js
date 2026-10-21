const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const input={orderId:'order_1',paymentId:'a'.repeat(32),amountFen:3000,reason:'协商退款'};
function fixture() {
  const storage=new Map(),calls=[];let owner='buyer',failWrite=false,revision=1;
  let submit=async()=>({refundId:'b'.repeat(32),status:'REQUESTED'});
  let find=async()=>{ const error=Error('missing');error.code='REFUND_NOT_FOUND';throw error; };
  function load() {
    const sandbox={module:{exports:{}},getApp:()=>({globalData:{account:{id:owner}},sessionRevision:revision}),
      wx:{getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>{if(failWrite)throw Error('full');storage.set(key,structuredClone(value));},removeStorageSync:key=>storage.delete(key)},
      require:()=>({requestRefund:async value=>{calls.push(value);return submit(value);},findRefund:value=>find(value),getRefund:async()=>({status:'REQUESTED'})})};
    vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/data/refund-draft'),'utf8'),sandbox);return sandbox.module.exports;
  }
  return {load,calls,renewSession:()=>revision++,setOwner:value=>owner=value,setSubmit:value=>submit=value,setFind:value=>find=value,setFailWrite:value=>failWrite=value};
}

test('unknown application recovers by request key without resubmitting when new requests are closed',async()=>{
  const f=fixture(),api=f.load();api.save(input);
  f.setSubmit(async()=>{throw Error('lost response');});await assert.rejects(api.submit(input.orderId));
  const saved=api.read(input.orderId);
  f.setSubmit(()=>assert.fail('must not submit an existing application'));
  f.setFind(async value=>{assert.equal(value.requestKey,saved.requestKey);return {refundId:'b'.repeat(32),status:'PROCESSING'};});
  assert.equal((await api.submit(input.orderId)).status,'PROCESSING');
  assert.equal(api.read(input.orderId).state,'ACKNOWLEDGED');assert.equal(f.calls.length,1);
});
test('failed recovery lookup never falls back to submission on network or permission errors',async()=>{
  const f=fixture(),api=f.load();api.save(input);f.setSubmit(async()=>{throw Error('timeout');});await assert.rejects(api.submit(input.orderId));
  f.setFind(async()=>{throw Error('offline');});await assert.rejects(api.submit(input.orderId));
  assert.equal(f.calls.length,1);assert.equal(api.read(input.orderId).state,'UNKNOWN');
});
test('lost response and page rebuild retain request key and lock edits until original request is resolved',async()=>{
  const f=fixture();let api=f.load();const original=api.save(input);
  f.setSubmit(async()=>{throw Error('timeout');});await assert.rejects(api.submit(input.orderId));
  api=f.load();assert.equal(api.read(input.orderId).requestKey,original.requestKey);
  assert.throws(()=>api.save({...input,amountFen:4000}),{code:'REFUND_DRAFT_LOCKED'});
  assert.throws(()=>api.startNext(input.orderId),{code:'REFUND_DRAFT_LOCKED'});
  f.setSubmit(async()=>({refundId:'b'.repeat(32)}));await api.submit(input.orderId);
  assert.equal(f.calls[0].requestKey,f.calls[1].requestKey);
  api.startNext(input.orderId);assert.equal(api.read(input.orderId),null);
});
test('double clicks coalesce and account switching cannot replace another account draft',async()=>{
  const f=fixture(),api=f.load();api.save(input);let resolve;
  f.setSubmit(()=>new Promise(done=>resolve=done));
  const first=api.submit(input.orderId),second=api.submit(input.orderId);assert.equal(first,second);assert.equal(f.calls.length,1);
  f.setOwner('other');assert.equal(api.read(input.orderId),null);api.save({...input,amountFen:2000});
  resolve({refundId:'b'.repeat(32)});await assert.rejects(first,{code:'AUTH_CONTEXT_CHANGED'});
  assert.equal(api.read(input.orderId).amountFen,2000);
});
test('storage failure before dispatch prevents network submission',()=>{
  const f=fixture(),api=f.load();api.save(input);f.setFailWrite(true);
  assert.throws(()=>api.submit(input.orderId),/full/);assert.equal(f.calls.length,0);
});
test('explicit first rejection permits corrections but a rejected retry cannot unlock an unknown application',async()=>{
  const f=fixture(),api=f.load();api.save(input);
  f.setSubmit(async()=>{throw {code:'REFUND_AMOUNT_EXCEEDED'};});
  await assert.rejects(api.submit(input.orderId));assert.equal(api.read(input.orderId).state,'DRAFT');
  api.save({...input,amountFen:2000});f.setSubmit(async()=>{throw Error('timeout');});
  await assert.rejects(api.submit(input.orderId));
  f.setSubmit(async()=>{throw {code:'REFUND_REQUEST_NOT_ENABLED'};});
  await assert.rejects(api.submit(input.orderId));assert.equal(api.read(input.orderId).state,'UNKNOWN');
});


test('same-account renewed session rejects an old success and preserves the original unknown key',async()=>{
 const f=fixture(),api=f.load(),saved=api.save(input);let finish;
 f.setSubmit(()=>new Promise(resolve=>{finish=resolve;}));const pending=api.submit(input.orderId);
 f.renewSession();finish({refundId:'b'.repeat(32)});
 await assert.rejects(pending,{code:'AUTH_CONTEXT_CHANGED'});
 assert.equal(api.read(input.orderId).state,'UNKNOWN');assert.equal(api.read(input.orderId).requestKey,saved.requestKey);
});
test('old lookup cannot dispatch a refund after same-account renewed login',async()=>{
 const f=fixture(),api=f.load();api.save(input);f.setSubmit(async()=>{throw Error('timeout');});await assert.rejects(api.submit(input.orderId));
 let fail;f.setFind(()=>new Promise((resolve,reject)=>{fail=reject;}));const pending=api.submit(input.orderId);
 f.renewSession();fail({code:'REFUND_NOT_FOUND'});await assert.rejects(pending);
 assert.equal(f.calls.length,1);assert.equal(api.read(input.orderId).state,'UNKNOWN');
});

test('new session recovers the same key independently and old completion cannot clear its pending request',async()=>{
 const f=fixture(),api=f.load(),saved=api.save(input);let finishOld,finishNew;
 f.setSubmit(()=>new Promise(resolve=>{finishOld=resolve;}));const old=api.submit(input.orderId);
 f.renewSession();f.setFind(value=>{assert.equal(value.requestKey,saved.requestKey);return new Promise(resolve=>{finishNew=resolve;});});
 const fresh=api.submit(input.orderId);assert.notEqual(fresh,old);
 finishOld({refundId:'b'.repeat(32)});await assert.rejects(old,{code:'AUTH_CONTEXT_CHANGED'});
 assert.equal(api.submit(input.orderId),fresh);
 finishNew({refundId:'b'.repeat(32)});await fresh;
 assert.equal(api.read(input.orderId).state,'ACKNOWLEDGED');assert.equal(f.calls.length,1);
});
