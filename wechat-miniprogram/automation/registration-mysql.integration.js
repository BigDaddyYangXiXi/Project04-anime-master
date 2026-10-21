// Isolated local schema only. Exercises production registration logic against real MySQL unique constraints.
const { test, before, after } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const mysql = require('../cloudfunctions/order-api/node_modules/mysql2/promise');
const { registerByPhone } = require('../cloudfunctions/account-bootstrap/phone-core');
const { NOTICE_VERSION } = require('../cloudfunctions/account-bootstrap/identity-core');
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024) throw Error('EXPLICIT_LOCAL_TEST_PORT_REQUIRED');
const database = 'anime_registration_test_' + crypto.randomBytes(8).toString('hex');
const config = { host: '127.0.0.1', port, user: 'root', password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || '' };
let admin, pool;
const db = { from(table) {
  let columns = '*', operation = 'select', values, ignore = false; const filters = [];
  const q = { select(c) { columns = c; return q; }, eq(k, v) { filters.push([k,v]); return q; },
    insert(v) { values = v; operation = 'insert'; return q; }, upsert(v,o) { values=v; ignore=o?.ignoreDuplicates; operation='insert'; return q; },
    update(v) { values=v; operation='update'; return q; }, async then(resolve,reject) {
      try {
        const where = filters.length ? ' WHERE ' + filters.map(([k]) => `\`${k}\`=?`).join(' AND ') : '';
        const args = filters.map(([,v]) => v);
        if (operation === 'select') { const [data] = await pool.query(`SELECT ${columns} FROM \`${table}\`${where}`, args); return resolve({data}); }
        if (operation === 'update') { const [r] = await pool.query(`UPDATE \`${table}\` SET ?${where}`, [values,...args]); return resolve({data:r.affectedRows?[{id:'updated'}]:[]}); }
        for (const value of Array.isArray(values)?values:[values]) await pool.query(`INSERT ${ignore?'IGNORE ':''}INTO \`${table}\` SET ?`,value);
        resolve({data:[]});
      } catch(error) { resolve({error:{code:error.code}}); }
    } }; return q;
} };
before(async () => {
  admin=await mysql.createConnection(config); await admin.query(`CREATE DATABASE \`${database}\``);
  pool=mysql.createPool({...config,database,connectionLimit:8});
  for(const file of ['0001_identity_core.sql','0014_account_registration_consents.sql','0015_account_phone_identities.sql','0016_account_auth_integrity_checks.sql','0017_discovery_location_preferences.sql','0034_account_registration_identity.sql','0035_username_case_and_punctuation.sql']) {
    for(const sql of fs.readFileSync(path.join(__dirname,'../database/mysql',file),'utf8').split(/;\s*(?:\r?\n|$)/).filter(s=>s.trim())) await pool.query(sql);
  }
});
after(async () => { if(pool) await pool.end(); if(admin) { await admin.query(`DROP DATABASE \`${database}\``); await admin.end(); } });
const key='test-phone-fingerprint-key-with-32-chars';
function register(id,nickname,username,phone) { return registerByPhone(db,{APPID:'app',OPENID:id},{nickname,username,acceptedNotice:true,noticeVersion:NOTICE_VERSION},{phoneNumber:phone,countryCode:'86'},key); }
test('real SQL concurrent canonical nickname claims yield exactly one complete account',async()=>{
  const values=await Promise.allSettled([register('one','ＴＡＯ桃','taotao01','13800138000'),register('two','tao桃','taotao02','13900139000')]);
  assert.equal(values.filter(v=>v.status==='fulfilled').length,1);
  const [[row]]=await pool.query("SELECT COUNT(*) AS n FROM accounts WHERE status='ACTIVE'"); assert.equal(row.n,1);
  assert.match(values.find(v=>v.status==='fulfilled').value.account.uid,/^\d{12}$/);
});
test('real SQL concurrent phone claims cannot leave an active unbound account',async()=>{
  const values=await Promise.allSettled([register('three','第三位','third_01','13700137000'),register('four','第四位','fourth01','13700137000')]);
  assert.equal(values.filter(v=>v.status==='fulfilled').length,1);
  const [[row]]=await pool.query("SELECT COUNT(*) AS n FROM accounts a LEFT JOIN account_phone_identities p ON a.id=p.account_id WHERE a.status='ACTIVE' AND p.account_id IS NULL"); assert.equal(row.n,0);
});
test('real SQL same WeChat simultaneous retry returns the same numeric UID',async()=>{
  const values=await Promise.all([register('five','第五位','fifth_01','13600136000'),register('five','第五位','fifth_01','13600136000')]);
  assert.equal(values[0].account.uid,values[1].account.uid);
  const [[row]]=await pool.query("SELECT COUNT(*) AS n FROM accounts WHERE username='fifth_01'"); assert.equal(row.n,1);
});

test('real SQL preserves capitalized punctuation names and rejects case-only duplicates',async()=>{
 const result=await register('six','第六位','John.Smith','13500135000');assert.equal(result.registered,true);
 const [[row]]=await pool.query("SELECT username FROM accounts WHERE username='john.smith'");assert.equal(row.username,'John.Smith');
 await assert.rejects(register('seven','第七位','john.smith','13400134000'),{code:'USERNAME_TAKEN'});
});
test('real SQL permits all ASCII punctuation without changing query meaning',async()=>{
 const punctuation=Array.from({length:94},(_,i)=>String.fromCharCode(i+33)).filter(v=>!/[a-z0-9]/i.test(v));
 for(const [index,char] of punctuation.entries())await pool.query("INSERT INTO accounts(id,uid,nickname,username,created_at,updated_at) VALUES(?,?,?,?,1,1)",['punct_'+index,'punct_'+index,'punct','X'+char]);
 const [[row]]=await pool.query("SELECT COUNT(*) AS n FROM accounts WHERE id LIKE 'punct_%'");assert.equal(row.n,punctuation.length);
 for(const name of ['a','a'.repeat(13),'hello world','中文'])await assert.rejects(pool.query("INSERT INTO accounts(id,uid,nickname,username,created_at,updated_at) VALUES('invalid','invalid','invalid',?,1,1)",[name]));
});
