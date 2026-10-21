const test=require('node:test'),assert=require('node:assert/strict');
const {review,listQueue}=require('./support-review');
test('operator queue exposes a next cursor and binds timestamp ties without accepting injected cursors',async()=>{
 let calls=0,args,sql;const rows=Array.from({length:101},(_,i)=>({id:'sup_'+String(i).padStart(3,'0'),created_at:100}));
 const pool={async execute(query,values){calls++;sql=query;args=values;return [values.length?rows.filter(r=>r.id>values[2]):rows];}};
 const first=await listQueue(pool);assert.equal(first.items.length,100);assert.deepEqual(first.cursor,{time:100,id:'sup_099'});
 const second=await listQueue(pool,first.cursor);assert.equal(second.items[0].id,'sup_100');assert.equal(second.cursor,null);assert.deepEqual(args,[100,100,'sup_099']);assert.match(sql,/created_at>\? OR \(created_at=\? AND id>\?\)/);
 await assert.rejects(listQueue(pool,{time:100,id:"' OR 1=1"}),{code:'VALIDATION_ERROR'});assert.equal(calls,2);
});
function fixture(){
 const row={id:'sup_one',account_id:'a',kind:'FEEDBACK',status:'PENDING',version:1,payload:JSON.stringify({events:[]})},calls=[];
 const connection={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},release(){calls.push('release');},async execute(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT'))return [[structuredClone(row)].filter(r=>r.id===args[0]&&r.account_id===args[1])];Object.assign(row,{payload:args[0],status:args[1],version:args[2],updated_at:args[3]});return [{affectedRows:1}];}};
 return {row,calls,pool:{async getConnection(){return connection;}}};
}
const input={id:'sup_one',accountId:'a',expectedVersion:1,idempotencyKey:'reply_one',status:'REPLIED',reply:'已收到说明，请在这里补充发生时间。'};
test('operator identity is required before opening a transaction and cannot come from the decision file',async()=>{
 const f=fixture();await assert.rejects(review(f.pool,{...input,operatorId:'forged'}),{code:'OPERATOR_ID_REQUIRED'});assert.deepEqual(f.calls,[]);
 await review(f.pool,{...input,operatorId:'forged'},'staff_real',100);
 assert.equal(JSON.parse(f.row.payload).events[0].operatorId,'staff_real');
});
test('operator reply locks the exact owner row, binds parameters, and retries once',async()=>{
 const f=fixture(),first=await review(f.pool,input,'staff_one',100);assert.equal(first.version,2);
 assert.equal((await review(f.pool,input,'staff_one',200)).repeated,true);
 assert.equal(f.calls.filter(c=>c.sql?.startsWith('UPDATE')).length,1);
 assert.match(f.calls.find(c=>c.sql?.startsWith('SELECT')).sql,/FOR UPDATE$/);
 assert.equal(f.calls.find(c=>c.sql?.startsWith('UPDATE')).sql.includes(input.reply),false);
 await assert.rejects(review(f.pool,{...input,status:'CLOSED'},'staff_one'),{code:'IDEMPOTENCY_CONFLICT'});assert.ok(f.calls.includes('rollback'));
});
test('operator stale, wrong-owner and closed decisions never update',async()=>{
 for(const scenario of ['stale','owner','closed']){
  const f=fixture();if(scenario==='closed')f.row.status='WITHDRAWN';
  await assert.rejects(review(f.pool,{...input,...(scenario==='stale'?{expectedVersion:0}:scenario==='owner'?{accountId:'b'}:{})},'staff_one'));
  assert.equal(f.calls.some(c=>c.sql?.startsWith('UPDATE')),false);assert.equal(f.calls.at(-1),'release');assert.ok(f.calls.includes('rollback'));
 }
});
