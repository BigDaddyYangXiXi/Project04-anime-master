const test=require('node:test'),assert=require('node:assert/strict');
const {runQuery,queryEvent}=require('./refund-operator-console');
const token='d'.repeat(64),query={action:'list',status:'REQUESTED'};
const deployment={envId:'cloudbase-d2g65rqbvee0bd978',functions:[{name:'payment-refund-operator',handler:'index.refundOperator',envVariables:{PAYMENT_REFUND_OPERATOR_TOKEN:token}}]};
const response = result => ({status:0,stdout:JSON.stringify({data:{Result:{InvokeResult:0,RetMsg:JSON.stringify(result)}}})});
test('query console rejects mutations and client-supplied credentials',()=>{
  for(const input of [{action:'review'},{action:'execute'},{...query,operatorToken:token},{...query,status:'ANY'}]) {
    assert.throws(()=>queryEvent(input),/INVALID_QUERY/);
  }
});
test('bank write command requires separate switch, rejects identity injection and keeps token off argv',()=>{
  const {runBankMutation}=require('./refund-operator-console');
  const configured=enabled=>({...deployment,functions:deployment.functions.map(fn=>({...fn,envVariables:{...fn.envVariables,
    BANK_BATCH_OPERATOR_ID:'finance',
    PAYMENT_WECHAT_CONFIG_B64:Buffer.from(JSON.stringify({refundOperatorEnabled:true,bankBatchEnabled:enabled})).toString('base64')}}))});
  const request={action:'bankReserve',requestKey:'batch_cli_00000001',paymentIds:['a'.repeat(32)]};
  assert.throws(()=>runBankMutation(request,deployment,()=>assert.fail()),/BANK_BATCH_OPERATOR_NOT_CONFIGURED/);
  assert.throws(()=>runBankMutation(request,configured(false),()=>assert.fail()),/BANK_BATCH_DISABLED/);
  for(const patch of [{operatorId:'fake'},{amountFen:1},{action:'execute'},{paymentIds:[]}])
    assert.throws(()=>runBankMutation({...request,...patch},configured(true),()=>assert.fail()),/INVALID_BANK_MUTATION/);
  for(const input of [request,{action:'bankCancel',batchId:'a'.repeat(32),reason:'取消草稿'}]) {
    runBankMutation(input,configured(true),(file,args,options)=>{
      assert.equal(args[1],'--private-bank');assert.doesNotMatch(JSON.stringify(args),new RegExp(token));
      assert.deepEqual(JSON.parse(options.input),{...input,operatorToken:token});
      return response({ok:true,data:{batchId:'a'.repeat(32),status:'RESERVED_DRAFT',payable:false}});
    });
  }
});
test('query console sends credential only through stdin and binds company function',()=>{
  const result=runQuery(query,deployment,(file,args,options)=>{
    assert.doesNotMatch(JSON.stringify(args),new RegExp(token));assert.equal(options.windowsHide,true);
    assert.deepEqual(JSON.parse(options.input),{...query,operatorToken:token});
    return response({ok:true,data:{records:[],nextCursor:null}});
  });
  assert.deepEqual(result,{records:[],nextCursor:null});
  assert.throws(()=>runQuery(query,{...deployment,envId:'other'},()=>assert.fail()),/OPERATOR_CONFIG_INVALID/);
});
test('query console never forwards failed subprocess output or raw error details',()=>{
  for(const child of [{status:1,stdout:token,stderr:token},{error:Error(token)},
    {status:0,stdout:token},response({ok:false,error:{message:token}})]) {
    assert.throws(()=>runQuery(query,deployment,()=>child),error=>error.message==='OPERATOR_QUERY_FAILED');
  }
});

test('review transport uses separate private mode, rejects execution and preserves stdin secrecy',()=>{
  const {runReview}=require('./refund-operator-console');
  assert.throws(()=>runReview({action:'execute'},deployment,()=>assert.fail()),/INVALID_REVIEW/);
  runReview({action:'review',refundId:'a'.repeat(32),decision:'REJECT',evidenceReference:'case_1'},deployment,(file,args,options)=>{
    assert.equal(args[1],'--private-review');assert.doesNotMatch(JSON.stringify(args),new RegExp(token));
    assert.equal(JSON.parse(options.input).action,'review');return response({ok:true,data:{status:'REJECTED'}});
  });
});

test('execution transport requires explicit money switch and sends only original refund ID',()=>{
  const {runExecution}=require('./refund-operator-console');
  const configured=enabled=>({ ...deployment,functions:deployment.functions.map(fn=>({...fn,envVariables:{...fn.envVariables,
    PAYMENT_WECHAT_CONFIG_B64:Buffer.from(JSON.stringify({refundOperatorEnabled:true,refundEnabled:enabled})).toString('base64')}}))});
  const request={action:'execute',refundId:'a'.repeat(32)};
  assert.throws(()=>runExecution(request,configured(false),()=>assert.fail()),/REFUND_EXECUTION_DISABLED/);
  runExecution(request,configured(true),(file,args,options)=>{
    assert.equal(args[1],'--private-execute');assert.doesNotMatch(JSON.stringify(args),new RegExp(token));
    assert.deepEqual(JSON.parse(options.input),{...request,operatorToken:token});return response({ok:true,data:{status:'PROCESSING'}});
  });
});

test('fund audit query binds payment ID without accepting client scope or repair flags',()=>{
  const input={action:'fundAudit',paymentId:'a'.repeat(32)};
  assert.deepEqual(queryEvent(input),input);
  for(const patch of [{paymentId:'bad'},{appid:'other'},{repair:true},{platformMchid:'other'}])assert.throws(()=>queryEvent({...input,...patch}),/INVALID_QUERY/);
  const audit={ok:false,paymentId:input.paymentId,issues:[{code:'REFUND_ALLOCATION_MISMATCH'}]};
  assert.deepEqual(runQuery(input,deployment,(file,args,options)=>{
    assert.equal(args[1],'--private-invoke');assert.deepEqual(JSON.parse(options.input),{...input,operatorToken:token});
    return response({ok:true,data:audit});
  }),audit);
});
