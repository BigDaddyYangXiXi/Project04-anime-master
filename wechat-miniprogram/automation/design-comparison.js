const fs=require('node:fs'),path=require('node:path');
const catalog=require('../design-system/catalog.json');
const before=require('../.artifacts/module-review-2026-09-09/capture.json');
const after=require('../.artifacts/design-migration-final/capture.json');
if(after.errors.length)throw new Error('仍有未完成的页面截图');
if(!catalog.pages.every(page=>after.pages.some(row=>row.route===page.route)))throw new Error('页面覆盖不完整');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=before.pages.map(old=>{
 const current=after.pages.find(row=>row.id===old.id);if(!current)throw new Error('缺少身份 '+old.id);
 const page=catalog.pages.find(page=>page.route===old.route);
 return {...current,name:page.name,modules:page.modules};
});
const image=(folder,id,position)=>`../.artifacts/${folder}/${id}-${position}.png`;
for(const row of rows)for(const folder of ['module-review-2026-09-09','design-migration-final'])for(const pos of ['top','bottom']){
 if(!fs.existsSync(path.resolve(__dirname,'../design-system',image(folder,row.id,pos))))throw new Error('图片缺失 '+row.id);
}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>动漫高手 · 修改前后</title>
<style>body{margin:0;background:#f8f7f5;color:#292523;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1440px;margin:auto;padding:24px}h1{font-size:28px;margin:0}h2{font-size:18px}p{max-width:900px}select{font:inherit;padding:10px;margin:8px 20px 8px 0}label{display:inline-block}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px}article{padding:16px;border:1px solid #e5e0da;background:white;border-radius:12px}article[hidden]{display:none}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;height:auto;display:block}a{color:#943a42}small{color:#766f69}</style>
<header><h1>动漫高手 · 实际修改前后</h1><p>26个路由、30组身份页面。左侧为修改前，右侧为本轮运行画面。已统一主次操作、常规字段及一批基础设计值；评价回复改为按条展开。截图使用本地审查数据，尚不代表所有业务状态、屏宽及真机验收。</p><p><a href="IMPLEMENTATION-2026-09-09.md">查看实际改动与验证边界</a></p><label>功能模块<br><select id="module"><option value="">全部</option>${catalog.modules.map(m=>`<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select></label><label>查看位置<br><select id="position"><option value="top">顶部</option><option value="bottom">滚动末尾</option></select></label><p id="count" aria-live="polite">显示30组页面</p></header>
<main>${rows.map(row=>`<article data-modules="${row.modules.join(' ')}"><h2>${escape(row.name)} · ${row.role==='provider'?'服务方':'需求方'}</h2><div class="pair">${['module-review-2026-09-09','design-migration-final'].map((folder,i)=>`<div><small>${i?'修改后':'修改前'}</small><a href="${image(folder,row.id,'top')}" data-base="${image(folder,row.id,'top').replace('-top.png','')}"><img loading="lazy" alt="${escape(row.name)} ${i?'修改后':'修改前'}" src="${image(folder,row.id,'top')}"></a></div>`).join('')}</div></article>`).join('')}</main>
<script>document.querySelector('#module').onchange=function(){let n=0;document.querySelectorAll('article').forEach(a=>{a.hidden=!!this.value&&!a.dataset.modules.split(' ').includes(this.value);if(!a.hidden)n++});document.querySelector('#count').textContent='显示'+n+'组页面'};document.querySelector('#position').onchange=function(){document.querySelectorAll('[data-base]').forEach(a=>{a.href=a.dataset.base+'-'+this.value+'.png';a.querySelector('img').src=a.href})};</script></html>`;
fs.writeFileSync(path.resolve(__dirname,'../design-system/implementation-board.html'),html);
console.log('前后对照生成完成：26路由／30组身份，120张配对视口图片。');
