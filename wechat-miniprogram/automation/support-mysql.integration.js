// Local random database only; never reads cloud credentials or user data.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const mysql=require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const {review,listQueue}=require('../scripts/support-review');
const port=Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('EXPLICIT_LOCAL_TEST_PORT_REQUIRED');
const database='support_test_'+crypto.randomBytes(8).toString('hex');let admin,pool;
before(async()=>{
 admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password:process.env.PAYMENT_TEST_MYSQL_PASSWORD||''});
 await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await admin.query(`USE \`${database}\``);
 const sql=name=>fs.readFileSync(path.join(__dirname,'../database/mysql',name),'utf8').replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim());
 for(const file of ['0001_identity_core.sql','0002_catalog_core.sql'])await admin.query(sql(file)[0]);
 for(const statement of sql('0010_media_purpose_and_saved_target_indexes.sql').filter(s=>!s.includes('account_saved_items')))await admin.query(statement);
 for(const file of ['0013_order_delivery_media_assets.sql','0055_support_requests.sql'])for(const statement of sql(file))await admin.query(statement);
 pool=mysql.createPool({host:'127.0.0.1',port,user:'root',password:process.env.PAYMENT_TEST_MYSQL_PASSWORD||'',database,connectionLimit:12});
});
after(async()=>{if(pool)await pool.end();if(admin){try{await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);}finally{await admin.end();}}});
async function seed(id,time=100){await pool.execute('INSERT INTO support_requests (id,account_id,kind,status,version,input_hash,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,'a','FEEDBACK','PENDING',1,'0'.repeat(64),JSON.stringify({description:'本地虚构测试申请，无用户数据。',events:[]}),time,time]);}
const decision=id=>({id,accountId:'a',expectedVersion:1,idempotencyKey:'reply_'+id,status:'REPLIED',reply:'请补充发生时间。'});
test('migration accepts support images and still rejects unknown purposes',async()=>{
 await pool.execute('INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES (?,?,?,1,1)',['a','TEST_A','local']);
 const insert='INSERT INTO media_assets (id,owner_account_id,purpose,storage_key,mime_type,size_bytes,status,created_at) VALUES (?,?,?,?,?,?,?,?)';
 await pool.execute(insert,['asset_local','a','SUPPORT_IMAGE','cloud://local/image','image/png',1,'READY',1]);
 await assert.rejects(pool.execute(insert,['asset_bad','a','UNSUPPORTED','cloud://local/bad','image/png',1,'READY',1]),{code:'ER_CHECK_CONSTRAINT_VIOLATED'});
});
test('twelve concurrent identical replies persist one event and one version increment',async()=>{
 await seed('sup_race');const outcomes=await Promise.all(Array.from({length:12},()=>review(pool,decision('sup_race'),'staff_one',200)));
 assert.equal(outcomes.filter(x=>!x.repeated).length,1);
 const [[row]]=await pool.execute('SELECT payload,version FROM support_requests WHERE id=?',['sup_race']);
 assert.equal(row.version,2);assert.equal(row.payload.events.length,1);assert.equal(row.payload.events[0].operatorId,'staff_one');
});
test('competing replies reject stale versions and rollback without a second event',async()=>{
 await seed('sup_compete');const a=decision('sup_compete'),b={...a,idempotencyKey:'different',reply:'另一位处理人员的回复。'};
 const outcomes=await Promise.allSettled([review(pool,a,'staff_a'),review(pool,b,'staff_b')]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'VERSION_CONFLICT');
 const [[row]]=await pool.execute('SELECT payload,version FROM support_requests WHERE id=?',['sup_compete']);assert.equal(row.payload.events.length,1);assert.equal(row.version,2);
});
test('real queue keyset pagination does not skip requests with equal timestamps',async()=>{
 for(let i=0;i<103;i++)await seed('queue_'+String(i).padStart(3,'0'),300);
 const first=await listQueue(pool),second=await listQueue(pool,first.cursor);
 assert.equal(first.items.length,100);assert.equal(second.items.length,3);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,103);assert.equal(second.cursor,null);
});
