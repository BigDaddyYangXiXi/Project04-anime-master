const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const output = path.resolve(__dirname, '../.artifacts/work-detail-parity-20260910');
(async () => {
 const app = await automator.connect({wsEndpoint:'ws://127.0.0.1:9422'});
 const results=[];
 try {
  const p=await app.reLaunch('/pages/work-detail/index?id=w-mu-1&audit=1');
  await new Promise(r=>setTimeout(r,1500));
  const scale=375/(await app.systemInfo()).windowWidth;
  const cases=[
   ['.related-service','margin-top',24],['.related-service','padding-top',24],['.related-service','border-top-width',1],
   ['.related-service-link','padding-top',16],['.related-service-link','padding-left',12],['.related-service-link','border-top-width',1],['.related-service-link','border-top-left-radius',10],
   ['.service-name','font-size',14],['.service-description','font-size',12],['.service-description','line-height',18],['.service-description','margin-top',6],
   ['.service-price .am-money','font-size',17],['.detail-title','font-size',17],['.detail-description','line-height',24],
   ['.work-code-bar','margin-top',24],['.work-code-bar','padding-top',16],['.work-code-bar','border-top-width',1],['.work-code-bar','border-bottom-width',0]
  ];
  for(const [selector,property,expected] of cases){const e=await p.$(selector);assert(e,selector);const value=await e.style(property);const actual=parseFloat(value)*scale;results.push({selector,property,expected,actual});assert(Math.abs(actual-expected)<=1,selector+' '+property+': '+actual+' != '+expected);}
  assert.equal((await(await p.$('.related-service-link')).size()).width,(await(await p.$('.related-service')).size()).width);
  await app.screenshot({path:path.join(output,'work-detail-buyer-top.png')});
  await app.pageScrollTo(100000);await new Promise(r=>setTimeout(r,300));await app.screenshot({path:path.join(output,'work-detail-buyer-bottom.png')});
  await app.reLaunch('/pages/work-detail/index?id=w-mu-1&audit=1&workspace=provider');await new Promise(r=>setTimeout(r,1200));
  const provider=await app.currentPage();assert.equal(await provider.$('.related-service'),null);assert.equal(await provider.$('.follow-button'),null);assert.equal(await provider.$('.work-action-bar'),null);
  await app.pageScrollTo(100000);await app.screenshot({path:path.join(output,'work-detail-provider-bottom.png')});
  fs.writeFileSync(path.join(output,'computed-parity.json'),JSON.stringify({at:new Date().toISOString(),basis:'approved work-detail-v2.html; normalized to 375px',results},null,2));
  console.log('PASS: '+results.length+' design measurements and provider visibility');
 }finally{app.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});

