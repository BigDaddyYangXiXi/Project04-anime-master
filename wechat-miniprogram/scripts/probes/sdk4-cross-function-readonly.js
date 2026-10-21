// Temporary fixed-target SDK transport probe: no business records, identities or secrets returned.
exports.main = async (event) => {
  if(process.env.SCF_NAMESPACE!=='cloudbase-d2g65rqbvee0bd978'||!event||Object.keys(event).length) return {ok:false,code:'PROBE_INPUT_REJECTED'};
  try {
    const sdk=require('@cloudbase/node-sdk');
    const app=sdk.init({env:'cloudbase-d2g65rqbvee0bd978',timeout:5000,retries:0});
    const reply=await app.callFunction({name:'auth-probe',data:{}});
    const rejected=reply?.result?.ok===false&&reply.result.error?.code==='AUTH_CONTEXT_MISSING';
    return {ok:rejected,node:process.version,sdk:require('@cloudbase/node-sdk/package.json').version,
      crossFunctionResponseParsed:typeof reply?.result==='object',anonymousRejected:rejected,businessWrites:false};
  } catch { return {ok:false,code:'SDK_CROSS_FUNCTION_FAILED',businessWrites:false}; }
};
