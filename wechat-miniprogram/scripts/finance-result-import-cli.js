const fs=require('node:fs');
const {saveFinanceResult}=require('./finance-tax-result-store');
const {reviewFinanceTaxResult}=require('./finance-tax-result-review');
async function main(argv=process.argv.slice(2),env=process.env,deps={}){
  if(argv.length!==3||argv[0]!=='--import')throw Error('FINANCE_IMPORT_ARGUMENTS_INVALID');
  const db=JSON.parse(env.ORDER_MYSQL_CONFIG||'null');
  const operator=env.BANK_BATCH_OPERATOR_ID;
  if(!db?.host||db.database!=='cloudbase-d2g65rqbvee0bd978'||db.user!=='am_finance_import'||typeof db.password!=='string'||!db.password
    ||!/^[A-Za-z0-9_-]{1,64}$/.test(operator||''))throw Error('FINANCE_IMPORT_CONFIG_REQUIRED');
  const read=deps.readFileSync||fs.readFileSync;
  const review=JSON.parse(read(argv[1],'utf8')),input=JSON.parse(read(argv[2],'utf8'));
  const scope={appid:'wxc94e1c1b38944511',platformMchid:'1750932981'};
  reviewFinanceTaxResult(review,input,operator);
  if(review.records.some(row=>row.payment?.appid!==scope.appid||row.payment?.platformMchid!==scope.platformMchid))throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  const createPool=deps.createPool||require('../cloudfunctions/payment-api/node_modules/mysql2/promise').createPool;
  const pool=createPool({host:db.host,port:db.port||3306,database:db.database,user:db.user,password:db.password,
    ssl:{rejectUnauthorized:true,verifyIdentity:true,...(db.ca?{ca:db.ca}:{})},multipleStatements:false,connectionLimit:1});
  try{
    const result=await (deps.save||saveFinanceResult)(pool,scope,review,input,operator);
    return {id:result.id,resultId:result.resultId,status:result.status,payable:false};
  }finally{await pool.end();}
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(()=>{
  console.error('FINANCE_RESULT_IMPORT_FAILED');process.exitCode=1;
});
module.exports={main};
