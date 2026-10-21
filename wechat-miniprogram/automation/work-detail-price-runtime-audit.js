const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const automator=require('miniprogram-automator');
const pause=()=>new Promise(r=>setTimeout(r,1400));
(async()=>{const app=await automator.connect({wsEndpoint:'ws://127.0.0.1:9422'});try{
const p=await app.reLaunch('/pages/work-detail/index?id=w-mu-1&audit=1');await pause();
const data=await p.data();assert.equal(data.work.price,520);assert.equal(data.relatedService.price,360);
assert.equal(await(await p.$('.action-price .am-money')).text(),data.relatedService.priceText);
assert.equal(await(await p.$('.service-price .am-money')).text(),data.relatedService.priceText);
await p.setData({relatedService:null});await pause();assert.equal(await(await p.$('.action-price .am-money')).text(),data.work.priceText);
await p.setData({relatedService:data.relatedService});await pause();
const out=path.resolve(__dirname,'../.artifacts/work-detail-price-20260910');fs.mkdirSync(out,{recursive:true});await app.pageScrollTo(100000);await app.screenshot({path:path.join(out,'detail.png')});
await(await p.$('.booking-button')).tap();await pause();const next=await app.currentPage();assert.equal(next.path,'pages/booking/index');const selected=await next.data('selectedServices');assert.equal(selected.length,1);assert.equal(selected[0].id,data.relatedService.id);assert.equal(selected[0].price,360);
fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({at:new Date().toISOString(),workPrice:520,cardPrice:360,footerPrice:360,bookingPrice:selected[0].price,serviceId:selected[0].id,unlinkedFallback:520},null,2));
await app.navigateBack();console.log('PASS: card, footer and booking use the same service price; unlinked fallback retained');
}finally{app.disconnect()}})().catch(e=>{console.error(e);process.exitCode=1});
