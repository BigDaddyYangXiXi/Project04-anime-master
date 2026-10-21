const test=require('node:test'),assert=require('node:assert/strict'),{handleSupport,recordReply}=require('./support-core');
function database(){
 const tables={accounts:[{id:'a',status:'ACTIVE'},{id:'b',status:'ACTIVE'}],wechat_identities:[{open_id:'oa',account_id:'a'},{open_id:'ob',account_id:'b'}],order_aggregates:[{id:'order',buyer_id:'b',provider_id:'b'}],support_requests:[],media_assets:[]};
 return {tables,from(name){let filters=[],op='select',value,limit=Infinity,orders=[];const q={select(){return q;},eq(k,v){filters.push(x=>x[k]===v);return q;},in(k,v){filters.push(x=>v.includes(x[k]));return q;},lt(k,v){filters.push(x=>x[k]<v);return q;},order(k,o){orders.push([k,o.ascending]);return q;},limit(n){limit=n;return q;},insert(v){op='insert';value=v;return q;},update(v){op='update';value=v;return q;},then(resolve){let data=tables[name].filter(x=>filters.every(f=>f(x)));if(op==='insert'){if(tables[name].some(x=>x.id===value.id))return Promise.resolve({error:true}).then(resolve);tables[name].push(structuredClone(value));data=[value];}if(op==='update')data.forEach(x=>Object.assign(x,value));data=data.slice().sort((a,b)=>{for(const[k,asc]of orders){if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1);}return 0;}).slice(0,limit);return Promise.resolve({data:structuredClone(data)}).then(resolve);}};return q;}};
}
const context={WX_OPENID:'oa'},input={action:'create',kind:'FEEDBACK',description:'首次打开小程序后定位读取非常缓慢。',idempotencyKey:'key'};
test('creation is owned, idempotent and binds content to key',async()=>{
 const db=database(),a=await handleSupport(db,input,context,100),b=await handleSupport(db,input,context,200);assert.equal(a.id,b.id);assert.equal(db.tables.support_requests.length,1);
 await assert.rejects(handleSupport(db,{...input,description:'这个说明内容已改变但是使用同一请求编号。'},context),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(handleSupport(db,{action:'get',id:a.id},{WX_OPENID:'ob'}),{code:'REQUEST_NOT_FOUND'});
 await assert.rejects(handleSupport(db,{...input,idempotencyKey:'order-key',orderId:'order'},context),{code:'ORDER_NOT_OWNED'});
 await assert.rejects(handleSupport(db,input,{}),{code:'AUTH_CONTEXT_MISSING'});
});
test('reply, supplement, withdrawal preserve history and reject stale updates',async()=>{
 const db=database(),a=await handleSupport(db,{...input,kind:'CANCEL'},context,100);
 const b=await recordReply(db,{id:a.id,accountId:'a',operatorId:'staff_one',expectedVersion:1,idempotencyKey:'reply',status:'PROCESSING',reply:'请先核对尚未完成的订单。'},200);assert.equal(b.events.length,2);
 await assert.rejects(handleSupport(db,{action:'append',id:a.id,expectedVersion:1,idempotencyKey:'old',description:'补充'},context),{code:'VERSION_CONFLICT'});
 const c=await handleSupport(db,{action:'withdraw',id:a.id,expectedVersion:2,idempotencyKey:'withdraw'},context,300);assert.equal(c.status,'WITHDRAWN');assert.equal(c.events.length,3);
 assert.equal((await handleSupport(db,{action:'withdraw',id:a.id,expectedVersion:2,idempotencyKey:'withdraw'},context,400)).version,3);
 assert.equal(db.tables.accounts[0].status,'ACTIVE');
 await assert.rejects(handleSupport(db,{action:'append',id:a.id,expectedVersion:3,idempotencyKey:'new',description:'补充'},context),{code:'REQUEST_CLOSED'});
});
test('pagination handles equal timestamps without exposing another account',async()=>{
 const db=database();for(let i=0;i<23;i++)await handleSupport(db,{...input,idempotencyKey:'k'+i},context,100);await handleSupport(db,input,{WX_OPENID:'ob'},100);
 const one=await handleSupport(db,{action:'list'},context),two=await handleSupport(db,{action:'list',cursor:one.cursor},context);assert.equal(one.items.length,20);assert.equal(two.items.length,3);assert.equal(new Set([...one.items,...two.items].map(x=>x.id)).size,23);assert.equal(two.cursor,null);
});
module.exports={database};
test('object-valued JSON rows support public reads and updates without mutating the read snapshot',async()=>{
 const db=database(),created=await handleSupport(db,input,context,100);
 const stored=db.tables.support_requests[0];stored.payload=JSON.parse(stored.payload);const snapshot=stored.payload;
 const read=await handleSupport(db,{action:'get',id:created.id},context);assert.equal(read.description,input.description);
 const result=await handleSupport(db,{action:'append',id:created.id,expectedVersion:1,idempotencyKey:'object_more',description:'本地对象字段补充'},context,200);
 assert.equal(result.events.length,2);assert.equal(snapshot.events.length,1);
});
test('a user supplement returns replied requests to the queue and hides operator identity',async()=>{
 const db=database(),a=await handleSupport(db,input,context,100);
 const reply={id:a.id,accountId:'a',operatorId:'staff_one',expectedVersion:1,idempotencyKey:'reply',status:'REPLIED',reply:'请补充具体发生时间。'};
 const b=await recordReply(db,reply,200);assert.equal(b.status,'REPLIED');
 assert.equal(b.events[1].operatorId,undefined);assert.equal(JSON.parse(db.tables.support_requests[0].payload).events[1].operatorId,'staff_one');
 const supplement={action:'append',id:a.id,expectedVersion:2,idempotencyKey:'more',description:'今天下午三点打开后等待了一分钟。'};
 const c=await handleSupport(db,supplement,context,300);assert.equal(c.status,'PROCESSING');assert.equal(c.version,3);
 assert.equal((await handleSupport(db,supplement,context,400)).version,3);
 assert.equal((await recordReply(db,reply,500)).status,'PROCESSING');
 await assert.rejects(recordReply(db,{...reply,operatorId:'staff_other'}),{code:'IDEMPOTENCY_CONFLICT'});
 for(const action of ['get','list']){const result=await handleSupport(db,{action,id:a.id},context);assert.equal(JSON.stringify(result).includes('staff_one'),false);}
});
test('reusing a create or append key cannot silently count as withdrawing an application',async()=>{
 const db=database(),a=await handleSupport(db,{...input,kind:'CANCEL'},context);
 await assert.rejects(handleSupport(db,{action:'append',id:a.id,expectedVersion:1,idempotencyKey:input.idempotencyKey,description:input.description},context),{code:'IDEMPOTENCY_CONFLICT'});
 await handleSupport(db,{action:'append',id:a.id,expectedVersion:1,idempotencyKey:'more',description:'已撤回注销申请。'},context);
 await assert.rejects(handleSupport(db,{action:'withdraw',id:a.id,expectedVersion:2,idempotencyKey:'more'},context),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(db.tables.support_requests[0].status,'PENDING');
});
test('support attachments require owned reviewed images and preserve uncertain-create retries',async()=>{
 const assetId='asset_'+'1'.repeat(32), fileId='cloud://private/support.png';
 const valid={id:assetId,owner_account_id:'a',purpose:'SUPPORT_IMAGE',status:'READY',storage_key:fileId,mime_type:'image/png',size_bytes:1024,committed_at:1};
 for(const patch of [{owner_account_id:'b'},{purpose:'AVATAR'},{status:'PENDING'},{status:'REJECTED'},{committed_at:null},{size_bytes:0},{size_bytes:'invalid'},{size_bytes:10485761},{mime_type:'application/pdf'},{storage_key:'https://other/image'}]) {
  const db=database();db.tables.media_assets.push({...valid,...patch});
  await assert.rejects(handleSupport(db,{...input,assetIds:[assetId]},context),{code:'ATTACHMENT_NOT_READY'});assert.equal(db.tables.support_requests.length,0);
 }
 const db=database();db.tables.media_assets.push(valid);
 await assert.rejects(handleSupport(db,{...input,assetIds:[assetId,assetId]},context),{code:'VALIDATION_ERROR'});
 const result=await handleSupport(db,{...input,assetIds:[assetId],attachments:[{fileId:'untrusted'}]},context);
 assert.deepEqual(result.attachments,[{assetId,fileId}]);db.tables.media_assets.length=0;
 assert.equal((await handleSupport(db,{...input,assetIds:[assetId]},context)).id,result.id);
 await assert.rejects(handleSupport(db,input,context),{code:'IDEMPOTENCY_CONFLICT'});
});
