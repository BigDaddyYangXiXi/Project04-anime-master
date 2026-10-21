const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
const context=await browser.newContext({viewport:{width:1380,height:1040},permissions:['clipboard-read','clipboard-write']});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:9446/work-detail-v2.html');await p.locator('#jumpinfo').click();await p.waitForTimeout(500);
const r=await p.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect();return {avatar:b('.avatar').height,follow:b('#follow').height,copyRight:b('#copy').right,codeRight:b('.code').right,gallery:b('#gallery').width,content:b('#content').width}});
assert.equal(r.avatar,r.follow);assert.equal(await p.locator('#inlinebooking').count(),1);assert.equal(r.copyRight,r.codeRight);assert.equal(r.gallery,r.content);
await p.locator('#follow').click();assert.equal(await p.locator('#follow').innerText(),'已关注');await p.locator('#like').click();assert.equal(await p.locator('#like').getAttribute('aria-pressed'),'true');await p.locator('#copy').click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'AM-ZN-20261001-028');
await p.screenshot({path:path.join(__dirname,'v2-work-overview.png'),fullPage:true});
await p.locator('#provider').click();assert.equal(await p.locator('#footer').isVisible(),false);assert.equal(await p.locator('#follow').isVisible(),false);await p.locator('#buyer').click();assert.equal(await p.locator('#footer').isVisible(),true);
await p.locator('#booking').click();assert.match(await p.locator('#overlay').innerText(),/AM-ZN-20261001-028/);await p.locator('.phone').screenshot({path:path.join(__dirname,'v2-work-booking.png')});
await p.locator('#continue').click();await p.waitForURL('**/?from=work&step=choose');assert.equal(await p.locator('#date').isVisible(),true);assert.match(await p.locator('#content').innerText(),/AM-ZN-20261001-028/);
await p.goto('http://127.0.0.1:9446/work-detail-v2.html');await p.setViewportSize({width:375,height:900});await p.locator('#jumpinfo').click();await p.waitForTimeout(450);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.locator('.phone').screenshot({path:path.join(__dirname,'v2-work-mobile.png')});
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'v2-work-verification.json'),JSON.stringify({at:new Date().toISOString(),measurements:r,errors,checks:['头像与关注等高','复制靠右','图集贴边','关注与喜欢','真实剪贴板','双身份','携带作品进入服务预约','375px无横向溢出']},null,2));console.log('PASS: work detail prototype checks');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
