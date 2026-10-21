// Exercises the installed CloudBase RDB SDK with a local callFunction transport.
// No cloud credentials or network calls; cloud gateway support still needs live verification.
const test=require('node:test'),assert=require('node:assert/strict');
const {generateMySQLClient}=require('../cloudfunctions/saved-items-api/node_modules/@cloudbase/wx-cloud-client-sdk');
const {handleSavedItems}=require('../cloudfunctions/saved-items-api/saved-items-core');
function fixture(countHeader='*/237'){
 const calls=[];
 const db=generateMySQLClient({async callFunction(request){
  calls.push(request);assert.equal(request.name,'httpOverCallFunction');const {url,method,headers}=request.data,u=new URL(url),table=u.pathname.split('/').at(-1);
  assert.equal(u.host,'127.0.0.1');assert.ok(['GET','HEAD'].includes(method));
  const p=u.searchParams;let body=[],responseHeaders={};
  if(table==='wechat_identities'){assert.equal(p.get('open_id'),'eq.test_openid');body=[{account_id:'acct_one'}];}
  else if(table==='accounts'){assert.equal(p.get('id'),'eq.acct_one');assert.equal(p.get('status'),'eq.ACTIVE');body=[{id:'acct_one'}];}
  else if(table==='provider_catalog_publications'){assert.equal(p.get('provider_id'),'eq.acct_one');body=[{payload:{profile:{},services:[],works:[{id:'work_one',title:'本地合成作品'}]}}];}
  else if(table==='account_saved_items'){
   assert.equal(p.get('saved'),'eq.1');
   if(method==='HEAD'){
    assert.match(headers.prefer,/count=exact/);assert.ok(['eq.acct_one','eq.work_one','in.(work_one)'].includes(p.get('target_id')));
    if(countHeader!==null)responseHeaders={'Content-Range':countHeader};
   } else {assert.equal(p.get('account_id'),'eq.acct_one');assert.equal(p.get('limit'),'20');assert.equal(p.get('order'),'target_id.asc');}
  } else throw Error('Unexpected table '+table);
  return {result:{statusCode:200,headers:responseHeaders,body}};
 }},{envId:'local_contract',mysqlBaseUrl:'http://127.0.0.1/local/rdb'})();
 return {db,calls};
}
test('real installed SDK sends HEAD exact requests and parses count headers beyond response limits',async()=>{
 const {db,calls}=fixture();const result=await handleSavedItems(db,{action:'listMine'},{WX_OPENID:'test_openid'});
 assert.equal(result.receivedProviderFollows,237);assert.equal(result.receivedWorkLikes,237);assert.deepEqual(result.providerIds,[]);assert.equal(calls.filter(c=>c.data.method==='HEAD').length,2);
 const detail=await handleSavedItems(db,{action:'listReceived',type:'likes'},{WX_OPENID:'test_openid'});assert.equal(detail.items[0].count,237);
});
test('missing and unknown count headers fail through the real SDK instead of returning zero',async()=>{
 for(const header of [null,'*/*']){const {db}=fixture(header);await assert.rejects(handleSavedItems(db,{action:'listMine'},{WX_OPENID:'test_openid'}),{code:'DATABASE_OPERATION_FAILED'});}
 const {db}=fixture('*/0');assert.equal((await handleSavedItems(db,{action:'listMine'},{WX_OPENID:'test_openid'})).receivedWorkLikes,0);
});
