const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(reply,namespace='cloudbase-d2g65rqbvee0bd978'){
 const module={exports:{}},calls=[];
 vm.runInNewContext(fs.readFileSync(require.resolve('./sdk4-cross-function-readonly'),'utf8'),{exports:module.exports,process:{env:{SCF_NAMESPACE:namespace},version:'v20.fixture'},require:name=>{
  if(name==='@cloudbase/node-sdk/package.json')return {version:'4.1.0'};
  assert.equal(name,'@cloudbase/node-sdk');return {init:config=>{assert.equal(config.retries,0);assert.equal(config.timeout,5000);return {callFunction:async input=>{calls.push(input);if(reply instanceof Error)throw reply;return reply;}};}};
 }});return {main:module.exports.main,calls};
}
test('fixed-target probe accepts only empty input in company environment',async()=>{
 for(const input of [null,{name:'other'},{OPENID:'forged'}]){const f=fixture({});assert.equal((await f.main(input)).code,'PROBE_INPUT_REJECTED');assert.equal(f.calls.length,0);}
 const f=fixture({},'other');assert.equal((await f.main({})).code,'PROBE_INPUT_REJECTED');
});
test('probe verifies actual denial envelope and never forwards details',async()=>{
 const f=fixture({result:{ok:false,error:{code:'AUTH_CONTEXT_MISSING'}}});assert.equal((await f.main({})).ok,true);assert.equal(f.calls[0].name,'auth-probe');assert.equal(Object.keys(f.calls[0].data).length,0);
 for(const reply of [{result:{ok:true,data:{secret:'private'}}},new Error('private'),{result:'bad'}]){const f=fixture(reply),r=await f.main({});assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/private/);}
});
