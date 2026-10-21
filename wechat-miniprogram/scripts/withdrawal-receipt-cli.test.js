const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {main}=require('./withdrawal-receipt-cli');
const env={ORDER_MYSQL_CONFIG:JSON.stringify({host:'test.invalid',database:'test',user:'finance',password:'synthetic'}),
  BANK_RECEIPT_SCOPE:JSON.stringify({appid:'wxc94e1c1b38944511',platformMchid:'1750932981'}),BANK_BATCH_OPERATOR_ID:'finance_owner'};

test('receipt recovery CLI only queries and closes its pool on success or failure',async()=>{
  const input={eventId:'a'.repeat(32),requestId:'b'.repeat(32),paymentId:'c'.repeat(32),providerId:'provider'};
  for(const fails of [false,true]){
    let closed=false;
    const call=main(['--find','query.json'],env,{
      readFileSync:()=>JSON.stringify(input),createPool:options=>{
        assert.equal(options.ssl.rejectUnauthorized,true);return {end:async()=>{closed=true;}};
      },record:()=>assert.fail('recovery must not write'),find:async(pool,value,scope)=>{
        assert.deepEqual(value,input);assert.equal(scope.appid,'wxc94e1c1b38944511');
        if(fails)throw Error('synthetic read failure');return {found:false,eventId:input.eventId};
      }
    });
    if(fails)await assert.rejects(call,/synthetic read failure/);
    else assert.deepEqual(await call,{found:false,eventId:input.eventId});
    assert.equal(closed,true);
  }
  await assert.rejects(main(['--find','query.json'],env,{readFileSync:()=>JSON.stringify({...input,status:'FAILED'}),
    createPool:()=>assert.fail('query must reject write fields')}),/INPUT_INVALID/);
});
test('receipt CLI uses verified TLS and server operator, excludes bank details from output',async()=>{
  let closed=false;
  const input={eventId:'a'.repeat(32),paymentId:'b'.repeat(32),status:'SUCCEEDED',bankTransactionReference:'PRIVATE_BANK_REFERENCE'};
  const result=await main(['--record','private.json'],env,{
    readFileSync:()=>JSON.stringify(input),createPool:options=>{
      assert.deepEqual(options.ssl,{rejectUnauthorized:true,verifyIdentity:true});assert.equal(options.multipleStatements,false);
      return {end:async()=>{closed=true;}};
    },record:async(pool,value,scope)=>{assert.equal(value.operatorId,'finance_owner');assert.equal(scope.platformMchid,'1750932981');return value;}
  });
  assert.deepEqual(result,{eventId:input.eventId,paymentId:input.paymentId,status:'SUCCEEDED'});assert.equal(closed,true);
});
test('missing scope, wrong merchant and operator overrides cannot connect',async()=>{
  for(const bad of [{...env,BANK_RECEIPT_SCOPE:'{}'},{...env,BANK_BATCH_OPERATOR_ID:''},
    {...env,BANK_RECEIPT_SCOPE:JSON.stringify({appid:'wxc94e1c1b38944511',platformMchid:'foreign'})}])
    await assert.rejects(main(['--record','unused'],bad,{createPool:()=>assert.fail('must not connect')}),/CONFIG_REQUIRED/);
  await assert.rejects(main(['--record','private.json'],env,{readFileSync:()=>'{"operatorId":"forged"}',createPool:()=>assert.fail('must not connect')}),/INPUT_INVALID/);
});
test('receipt failures release connection and CLI does not print exception details',async()=>{
  let closed=false;
  await assert.rejects(main(['--record','private.json'],env,{readFileSync:()=>'{}',createPool:()=>({end:async()=>{closed=true;}}),
    record:async()=>{throw Error('private failure');}}),/private failure/);
  assert.equal(closed,true);
  const result=spawnSync(process.execPath,[require.resolve('./withdrawal-receipt-cli'),'--record','unused'],{
    env:{...process.env,ORDER_MYSQL_CONFIG:'private failure'},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'WITHDRAWAL_RECEIPT_FAILED');
});
