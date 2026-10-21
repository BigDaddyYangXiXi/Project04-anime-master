// One vector family; SVG components and native tab PNGs share geometry and tokens.
const fs=require('node:fs');
const path=require('node:path');
const tokens=require('../design-system/tokens.json');
const shapes={
 market:'<path d="M4 10.5 12 4l8 6.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 14v2m7-2-2 1 2 1"/>',
 order:'<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V3h6v1M9 10h6m-6 4h6m-6 3h3"/>',
 project:'<path d="M3 8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 13h8m-8 4h5"/>',
 profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 6 0 0 1 16 0v2"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
 workbench:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7m-3.5-3.5h7"/>'
};
function svg(name,active){
 const color=tokens[active?'color-brand':'color-text-secondary'];
 let geometry=shapes[name];
 if(active){
  geometry=geometry.replace(/<(path|rect|circle) /,`<$1 fill="${color}" `);
  if(!['profile','workbench'].includes(name))geometry=geometry.replace(/\/><path /,`/><path stroke="${tokens['color-on-brand']}" `);
  if(name==='profile')geometry=geometry.replace('/><path ',`/><path fill="${color}" `);
  if(name==='workbench')geometry=geometry.replace(/<rect /g,`<rect fill="${color}" `).replace(`fill="${color}" fill="${color}"`,`fill="${color}"`);
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="1.5 1.5 21 21" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${geometry}</svg>`;
}
async function build(){
 const sharp=require(process.argv[2]||'sharp');
 const dir=path.resolve(__dirname,'../miniprogram/assets/nav');
 for(const name of Object.keys(shapes))for(const active of [false,true]){
  const content=svg(name,active),base=path.join(dir,`${name}-line${active?'-active':''}`);
  fs.writeFileSync(base+'.svg',content);await sharp(Buffer.from(content)).png().toFile(base+'.png');
 }
 const file=path.resolve(__dirname,'../miniprogram/app.json'),app=JSON.parse(fs.readFileSync(file,'utf8'));
 app.tabBar.color=tokens['color-text-secondary'];app.tabBar.selectedColor=tokens['color-brand'];
 app.tabBar.backgroundColor=tokens['color-canvas'];
 app.window.backgroundColor=tokens['color-canvas'];
 app.window.navigationBarBackgroundColor=tokens['color-canvas'];
 for(const item of app.tabBar.list){const name=item.iconPath.split('/').pop().split('-')[0];item.iconPath=`assets/nav/${name}-line.png`;item.selectedIconPath=`assets/nav/${name}-line-active.png`;}
 fs.writeFileSync(file,JSON.stringify(app,null,2)+'\n');
 console.log('6种导航图形、12种状态：SVG与原生PNG已从同一来源生成。');
}
if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1});
module.exports={shapes,svg};
