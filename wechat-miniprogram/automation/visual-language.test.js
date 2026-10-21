const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const tokens=require('../design-system/tokens.json');
const {shapes,svg}=require('./build-navigation-icons');
const root=path.resolve(__dirname,'../miniprogram');
function luminance(hex){return hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
test('主操作前景与品牌背景的对比度至少4.5:1',()=>{
 for(const key of ['color-brand','color-brand-pressed']){
  const values=[luminance(tokens[key]),luminance(tokens['color-on-brand'])].sort((a,b)=>b-a);
  assert.ok((values[0]+.05)/(values[1]+.05)>=4.5,key);
 }
});
test('导航的原生与组件图标同源，选中态与按钮共享品牌色',()=>{
 const app=require('../miniprogram/app.json');
 assert.equal(app.tabBar.selectedColor,tokens['color-brand']);
 assert.equal(app.tabBar.color,tokens['color-text-secondary']);
 assert.equal(app.tabBar.backgroundColor,tokens['color-canvas']);
 for(const name of Object.keys(shapes))for(const active of [false,true]){
  const file=path.join(root,`assets/nav/${name}-line${active?'-active':''}`);
  assert.equal(fs.readFileSync(file+'.svg','utf8'),svg(name,active));
  const png=fs.readFileSync(file+'.png');assert.equal(png.readUInt32BE(16),72);assert.equal(png.readUInt32BE(20),72);
 }
 for(const page of ['discover','orders','projects','me']){
  const source=fs.readFileSync(path.join(root,`pages/${page}/index.js`),'utf8');
  assert.ok(source.includes('selectedIconPath: homeIcon.replace(".png", "-active.png")'));
  assert.ok(source.includes('selectedIconPath: thirdIcon.replace(".png", "-active.png")'));
 }
});
