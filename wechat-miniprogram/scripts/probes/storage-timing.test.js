const test=require('node:test'),assert=require('node:assert/strict');
const {storageTiming}=require('./storage-timing');
const fileId='cloud://cloudbase-d2g65rqbvee0bd978.bucket/test.png';
function app(){const q={select(){return q;},eq(){return q;},limit:async()=>({data:[{id:'private-id'}]})};return {
  rdb:()=>({from:()=>q}),getTempFileURL:async()=>({fileList:[{fileID:fileId,code:'SUCCESS',tempFileURL:'https://example.test/private?signature=secret'}]}),
  getFileInfo:async()=>({fileList:[{fileID:fileId,code:'SUCCESS',size:10}]})};}
test('invalid environment or mode fails before access',async()=>{
  assert.equal((await storageTiming({fileId:'cloud://foreign.bucket/test',mode:'split'},null)).code,'INVALID_PROBE_INPUT');
});
test('split probe issues HEAD only and returns no private IDs or URLs',async()=>{
  const result=await storageTiming({fileId,mode:'split'},app(),async(url,options)=>{
    assert.equal(options.method,'HEAD');assert.ok(options.signal);return {ok:true,status:200,headers:{get:()=> '10'}};
  });
  assert.equal(result.ok,true);assert.equal(result.sizeBytes,10);assert.doesNotMatch(JSON.stringify(result),/secret|private|cloud:\/\//);
});
test('SDK timing and failures return metadata only',async()=>{
  assert.equal((await storageTiming({fileId,mode:'sdk'},app())).sizeBytes,10);
  const result=await storageTiming({fileId,mode:'split'},app(),async()=>{throw Error('secret');});
  assert.equal(result.stage,'head');assert.doesNotMatch(JSON.stringify(result),/secret/);
});
