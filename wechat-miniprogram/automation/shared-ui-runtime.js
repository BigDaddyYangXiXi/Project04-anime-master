const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const brand = require('../design-system/tokens.json')['color-brand'].slice(1).match(/../g).map(v=>parseInt(v,16));
const brandRgb = `rgb(${brand.join(', ')})`;
async function main() {
 const app=await automator.connect({wsEndpoint:'ws://127.0.0.1:9422'});
 const output=path.resolve(__dirname,process.argv[2]||'../.artifacts/design-migration-final');
 const result=[];
 try {
  let page=await app.reLaunch('/pages/provider-reviews/index?audit=1');
  await page.waitFor(1200);
  const reviews=await page.data('reviews');
  const target=reviews.find(row=>!row.reviewReply);
  assert.ok(target,'需要可回复评价');
  assert.equal(await page.$('.reply-editor'),null);
  await (await page.$('.reply-toggle')).tap();
  await page.waitFor(300);
  assert.equal(await page.data('editingReplyId'),target.id);
  assert.ok(await page.$('.reply-editor'));
  await page.callMethod('update',{currentTarget:{dataset:{id:target.id}},detail:{value:'审查草稿，不提交'}});
  await (await page.$('.reply-toggle')).tap();
  await page.waitFor(300);
  assert.equal(await page.$('.reply-editor'),null);
  await (await page.$('.reply-toggle')).tap();
  await page.waitFor(300);
  assert.equal((await page.data('drafts'))[target.id],'审查草稿，不提交');
  await app.screenshot({path:path.join(output,'review-expanded.png')});
  result.push({case:'回复展开／收起原生点击与草稿保留',passed:true});
  for(const route of ['/pages/booking/index?providerId=1&audit=1','/pages/provider-detail/index?id=1&audit=1','/pages/auth/index?audit=1']) {
   await app.reLaunch(route);await new Promise(r=>setTimeout(r,1000));
   const styles=await app.evaluate(()=>new Promise(resolve=>wx.createSelectorQuery().selectAll('.am-action-primary').fields({computedStyle:['background-color','font-size','min-height','border-radius']},resolve).exec()));
   assert.ok(styles.length,route+' 缺主动作');
   for(const style of styles){assert.ok(parseFloat(style['min-height'])>=44);assert.equal(style['background-color'],brandRgb);}
   result.push({route,styles,passed:true});
  }
  const calendar=await app.reLaunch('/pages/provider-calendar/index?audit=1');
  await new Promise(r=>setTimeout(r,1000));
  assert.equal(await calendar.data('changed'),false);
  assert.equal(String(await (await calendar.$('.am-action-primary')).property('disabled')),'true');
  const disabledStyles=await app.evaluate(()=>new Promise(resolve=>wx.createSelectorQuery().selectAll('.am-action-primary').fields({computedStyle:['background-color','opacity','min-height']},resolve).exec()));
  assert.ok(disabledStyles.length,'档期页缺少禁用主操作');
  for(const style of disabledStyles){assert.equal(style['background-color'],brandRgb);assert.equal(style.opacity,'0.5');assert.ok(parseFloat(style['min-height'])>=44);}
  result.push({case:'禁用主操作保留品牌色及触控尺寸',styles:disabledStyles,passed:true});
 } finally {app.disconnect();fs.writeFileSync(path.join(output,'runtime-check.json'),JSON.stringify(result,null,2));}
 console.log('共享主操作实际样式、回复展开与草稿保留通过；未提交评价或付款。');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
