const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const sharp = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const out = path.resolve(__dirname, '../.artifacts/auth-vi-' + new Date().toISOString().replace(/[:.]/g, '-'));
async function main() {
  await new Promise(r => setTimeout(r, 3000));
  const connection = await Connection.create('ws://127.0.0.1:9422');
  const app = new MiniProgram(connection), shots = [], errors = [], checks = [], frames = [];
  app.on('exception', e => errors.push(e));
  const shot = async name => { shots.push([name, await app.screenshot()]); console.log(name); };
  try {
    for (const state of process.argv.includes('--transitions-only') ? [] : ['loading', 'login', 'register', 'error', 'success']) {
      const page = await app.reLaunch('/pages/auth/index?audit=1&state=' + state); await page.waitFor(700);
      const rect = await app.evaluate(() => new Promise(resolve => wx.createSelectorQuery().select('.brand-visual').fields({rect:true,size:true}, resolve).exec()));
      assert(rect && rect.width >= 160, '品牌标志完整可见');
      await shot(state);
      if (state === 'register') {
        await page.callMethod('preparePhone'); assert.equal(await page.data('fieldError'), true); await shot('register-validation');
        await page.callMethod('updateNickname', {detail:{value:'新的创作者'}}); await page.callMethod('toggleNotice');
        assert.equal(await page.data('canRegister'), true);
        await page.callMethod('switchMode', {currentTarget:{dataset:{mode:'login'}}});
        await page.callMethod('switchMode', {currentTarget:{dataset:{mode:'register'}}});
        assert.equal(await page.data('nickname'), '新的创作者');
        await app.pageScrollTo(100000); await shot('register-ready-bottom'); checks.push('注册门禁、登录注册切换及输入保留');
      }
    }
    await app.reLaunch('/pages/discover/index');
    for (const [method, options] of [
      ['navigateTo',{url:'/pages/provider-detail/index?id=1&audit=1'}],
      ['navigateBack',{delta:1}], ['switchTab',{url:'/pages/me/index'}],
      ['switchTab',{url:'/pages/orders/index'}], ['switchTab',{url:'/pages/projects/index'}],
      ['reLaunch',{url:'/pages/auth/index?audit=1&state=login'}],
      ['reLaunch',{url:'/pages/discover/index'}]
    ]) {
      console.log('transition', method, options.url || 'back');
      const result = await app.callWxMethod(method, options);
      assert.equal(result.errMsg, method + ':ok');
      for (let i=0;i<6;i++) { const name = 'transition-' + frames.length; const data = await app.screenshot(); shots.push([name,data]); frames.push({name,method,route:options.url || 'back',at:Date.now()}); }
      await new Promise(resolve => setTimeout(resolve, 1000));
      const page = await app.currentPage();
      assert.equal(page.path, (options.url || '/pages/discover/index').split('?')[0].slice(1));
    }
    checks.push('navigateTo / navigateBack / switchTab / reLaunch 导航完成后画面与路由采样');
    assert.equal(errors.length,0,JSON.stringify(errors));
  } finally {
    app.disconnect(); fs.mkdirSync(out,{recursive:true});
    for (const [name,data] of shots) {
      fs.writeFileSync(path.join(out,name+'.png'),data,'base64');
      const frame=frames.find(f=>f.name===name);
      if(frame) {
        const {data:pixels,info}=await sharp(Buffer.from(data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
        let white=0,count=0;
        for(let y=Math.floor(info.height*.12);y<info.height*.9;y++) for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;count++;if(pixels[i]>235&&pixels[i+1]>235&&pixels[i+2]>235)white++;}
        frame.whiteRatio=white/count;
      }
    }
    fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify({checks,errors,frames,postNavigationPassed:errors.length===0 && checks.includes('navigateTo / navigateBack / switchTab / reLaunch 导航完成后画面与路由采样') && frames.length===42 && frames.every(f=>f.whiteRatio<.8),boundary:'仅采样导航接口返回后的画面，不覆盖完整过渡动画，不能证明白闪消失；开发工具采样不是真机录屏，手机号实际授权未验收'},null,2));
    console.log('Evidence:', out);
  }
  assert(frames.every(f=>f.whiteRatio<.8),'切换采样出现大面积白屏');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
