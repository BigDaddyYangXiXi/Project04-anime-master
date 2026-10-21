const fs=require('node:fs');
const {reviewFinanceTaxResult}=require('./finance-tax-result-review');
const {templateCsv,reviewCsv}=require('./finance-tax-result-csv');
function main(argv=process.argv.slice(2)){
  if(argv.length===3&&argv[0]==='--template'){
    const review=JSON.parse(fs.readFileSync(argv[1],'utf8'));
    fs.writeFileSync(argv[2],templateCsv(review),{flag:'wx',mode:0o600});
    return {templateCreated:true,records:review.records.length,payable:false};
  }
  if(argv.length===6&&argv[0]==='--review-csv'){
    const [,sourceFile,csvFile,metadataFile,outputFile,operatorId]=argv;
    const result=reviewCsv(JSON.parse(fs.readFileSync(sourceFile,'utf8')),fs.readFileSync(csvFile,'utf8'),
      JSON.parse(fs.readFileSync(metadataFile,'utf8')),operatorId);
    fs.writeFileSync(outputFile,JSON.stringify({...result,checkedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    return {status:result.status,records:result.records.length,payable:false};
  }
  if(argv.length!==5||argv[0]!=='--review')throw Error('FINANCE_RESULT_ARGUMENTS_INVALID');
  const [ ,sourceFile,resultFile,outputFile,operatorId]=argv;
  const review=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
  const input=JSON.parse(fs.readFileSync(resultFile,'utf8'));
  const result=reviewFinanceTaxResult(review,input,operatorId);
  fs.writeFileSync(outputFile,JSON.stringify({...result,checkedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
  return {status:result.status,records:result.records.length,payable:false};
}
if(require.main===module){
  try{console.log(JSON.stringify(main()));}
  catch{console.error('FINANCE_RESULT_REVIEW_FAILED');process.exitCode=1;}
}
module.exports={main};
