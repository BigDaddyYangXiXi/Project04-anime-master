const fs=require('node:fs');
const {recordWithdrawalReceipt}=require('./record-withdrawal-receipt');
const {findWithdrawalReceipt}=require('./find-withdrawal-receipt');
async function main(argv=process.argv.slice(2),env=process.env,deps={}){
  if(argv.length!==2||!['--record','--find'].includes(argv[0]))throw Error('WITHDRAWAL_RECEIPT_ARGUMENTS_INVALID');
  const db=JSON.parse(env.ORDER_MYSQL_CONFIG||'null');
  const scope=JSON.parse(env.BANK_RECEIPT_SCOPE||'null');
  const operator=env.BANK_BATCH_OPERATOR_ID;
  if(!db?.host||!db.database||!db.user||db.user==='am_payment'||typeof db.password!=='string'
    ||!/^[A-Za-z0-9_-]{1,64}$/.test(operator||'')
    ||scope?.appid!=='wxc94e1c1b38944511'||scope?.platformMchid!=='1750932981')throw Error('WITHDRAWAL_RECEIPT_CONFIG_REQUIRED');
  const input=JSON.parse((deps.readFileSync||fs.readFileSync)(argv[1],'utf8'));
  const fields=argv[0]==='--find'?['eventId','requestId','paymentId','providerId']
    :['eventId','requestId','paymentId','accountVersionId','providerId','amountFen','status','evidenceReference','bankResultVerified','bankTransactionReference'];
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw Error('WITHDRAWAL_RECEIPT_INPUT_INVALID');
  const createPool=deps.createPool||require('../cloudfunctions/payment-api/node_modules/mysql2/promise').createPool;
  const pool=createPool({host:db.host,port:db.port||3306,database:db.database,user:db.user,password:db.password,
    ssl:{rejectUnauthorized:true,verifyIdentity:true,...(db.ca?{ca:db.ca}:{})},multipleStatements:false,connectionLimit:1});
  try{
    if(argv[0]==='--find')return await (deps.find||findWithdrawalReceipt)(pool,input,scope);
    const result=await (deps.record||recordWithdrawalReceipt)(pool,{...input,operatorId:operator},scope);
    return {eventId:result.eventId,paymentId:result.paymentId,status:result.status};
  }finally{await pool.end();}
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(()=>{
  console.error('WITHDRAWAL_RECEIPT_FAILED');process.exitCode=1;
});
module.exports={main};
