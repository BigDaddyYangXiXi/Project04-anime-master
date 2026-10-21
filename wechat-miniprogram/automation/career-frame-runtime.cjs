const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
async function main() {
  const app = new MiniProgram(await Connection.create('ws://127.0.0.1:9422'));
  const shots = [], checks = [];
  const info = await app.callWxMethod('getStorageInfoSync');
  const role = await app.callWxMethod('getStorageSync','animeMasterRole');
  try {
    await app.callWxMethod('setStorageSync','animeMasterRole','buyer');
    const page = await app.reLaunch('/pages/discover/index?audit=1'); await page.waitFor(800);
    const original = await page.data('career');
    const before = await (await page.$('.career-chip')).size();
    for (const [index, career] of ['妆娘','毛娘','摄影','后期'].entries()) {
      await (await page.$('.career-section')).scrollTo(index < 2 ? 0 : 10000, 0);
      await page.waitFor(300);
      await (await page.$(`.career-chip[data-career="${career}"]`)).tap(); await page.waitFor(400);
      assert.equal((await page.$$('.career-chip.active')).length,1);
      assert.equal(await (await page.$('.career-chip.active')).attribute('data-career'),career);
      assert.deepEqual(await (await page.$('.career-chip')).size(),before);
      const frames = await app.evaluate(() => new Promise(resolve => wx.createSelectorQuery().selectAll('.career-frame').fields({computedStyle:['background-image']},resolve).exec()));
      assert.equal(frames.filter(frame => frame['background-image'].includes('linear-gradient')).length,1);
      shots.push([career,await app.screenshot()]);
    }
    await page.callMethod('chooseCareer',{currentTarget:{dataset:{career:original}}});
    await (await page.$('.career-section')).scrollTo(0,0);
    checks.push('四职业原生点击切换、唯一彩虹外框计算样式、按钮尺寸不变、横滑末端实屏');
  } finally {
    if(info.keys.includes('animeMasterRole')) await app.callWxMethod('setStorageSync','animeMasterRole',role);
    else await app.callWxMethod('removeStorageSync','animeMasterRole');
    app.disconnect();
    const out=path.resolve(__dirname,'../.artifacts/career-active-frame');fs.mkdirSync(out,{recursive:true});
    for(const [name,data] of shots)fs.writeFileSync(path.join(out,name+'.png'),data,'base64');
    fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify({checks},null,2));
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
