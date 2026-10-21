const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../design-system/catalog.json');
const evidence = require('../.artifacts/module-review-2026-09-09/capture.json');
const target = path.resolve(__dirname, '../design-system');
const notes = {
  auth: '本次为注册态；品牌图可保留，橙色主按钮与业务页珊瑚按钮需按品牌／业务语义收敛，协议阅读与输入状态专项补验。',
  discover: '需求方保留职业入口与作品卡；服务方保留有界待办。管理工具彩虹次按钮过强，两身份信息密度不同但基础制式须一致。',
  'search-results': '本次为空结果；标题、空态与发现搜索入口应共用。需补有结果与展开搜索层。',
  'work-detail': '保留已认可的作者关注、作品喜欢、预约主操作分工；首尾内容可见。占位图不能代替真实横竖作品验收。',
  'provider-detail': '服务选择信息完整，但身份、预约须知、服务与作品多层容器需收敛；底部预约与作品详情须共用操作规则。',
  'provider-schedule': '公开日历保留可约／满客／未公开区分；状态小字及主按钮颜色需统一；历史日期是审查数据。',
  booking: '字段分组可保留；同服务项与服务详情的选中规则、价格层级需共享。缺项可见性与键盘状态须补验。',
  'booking-status': '状态、进度及说明重复强调；压低辅助信息，突出当前责任方。仅采到待处理阶段。',
  'order-detail': '本次出现前置阶段提示，并非执行详情；提示应共用状态模块，详情状态不能视为已审。',
  'provider-home': '实际转入发现页服务方工作台；复用同一整改项，不另造工作台设计。',
  'provider-request': '当前为联系与条件确认；嵌套卡片、标题与状态偏重，复制／拨号应为低强调工具。执行、交付分支待补。',
  'provider-profile': '导航和正文重复标题；字段、作品管理卡、保存按钮需共用变体。新建作品、服务编辑和关联弹层待补。',
  'provider-calendar': '保留兼容入口与公开档期语义差别；编辑日历和projects服务方使用同套规则，保存／撤销态待补。',
  'provider-task': '本次待签态；谁先签、谁后签应比装饰标题更突出；可签和已签仍待补。',
  orders: '供需连续行可保留；同一行内订单号／时间偏小，标题与金额偏重；两身份统一信息等级。',
  projects: '需求方连续项目列表可保留，新增按钮过度装饰；服务方是日历任务，应统一日历而非强行套项目列表。',
  'project-detail': '渐变概览、嵌套订单行与长来源说明混用；精简概览，关联行与订单事实共享，资料分组显示。',
  brief: '来源资料占据长篇输入区；字段表现与预约不同。存在已显示城市仍提示缺城市的状态矛盾，须独立复现。',
  fulfillment: '确认事实、交付物、修改意见的顺序合理；事实字偏小、次按钮装饰过强；真支付与未展开状态不在本次验收内。',
  review: '本次是已评价成功态，品牌反馈可保留；星形展示与其他评分不统一。评分输入和失败态待补。',
  'provider-orders': '兼容列表与orders服务方一起收敛；禁止修改主列表后遗留这一份副本。',
  'provider-reviews': '多个评价均展开大回复框，阅读被编辑打断；改为先读评价、当前回复展开，保留已回复正文。',
  me: '保留资产条目与角色分工；头像、数据格与功能捷径强调方式不一致，角色间复用同一基础规则。',
  'account-profile': '头像编辑使用大圆角方形，与详情圆头像冲突；字段和保存按钮需纳入同模块。',
  'me-assets': '本次为喜欢空态；有内容、关注与引用列表未实拍，不将空态截图计为全部资产设计通过。',
  funds: '待开通与无记录是本次实际画面；保持真实能力边界，使用统一事实／状态层级，补有记录与核对异常。'
};
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
for (const page of catalog.pages) {
  if (!notes[page.route.split('/')[1]]) throw new Error(`缺少审查结论 ${page.route}`);
  if (!evidence.pages.some(row => row.route === page.route)) throw new Error(`缺少页面采集 ${page.route}`);
}
const rows = evidence.pages.map(row => {
  const page = catalog.pages.find(entry => entry.route === row.route);
  for (const position of ['top', 'bottom']) if (!fs.existsSync(path.join(target, `../.artifacts/module-review-2026-09-09/${row.id}-${position}.png`))) throw new Error(`缺截图 ${row.id}`);
  return { ...row, name: page.name, note: notes[row.route.split('/')[1]], modules: page.modules };
});
const imagePath = (id, position) => `../.artifacts/module-review-2026-09-09/${id}-${position}.png`;
fs.writeFileSync(path.join(target, 'SCREEN-INDEX-2026-09-09.md'), '# 当前页面画面与审查索引\n\n本地审查数据，首尾视口，不代表所有状态或真机验收。完整决定见[审查报告](REVIEW-2026-09-09.md)。\n\n| 页面／身份 | 当前画面 | 审查结论 |\n|---|---|---|\n' + rows.map(row => `| ${row.name}／${row.role} | [顶部](${imagePath(row.id, 'top')}) · [末尾](${imagePath(row.id, 'bottom')}) | ${row.note} |`).join('\n') + '\n');
fs.writeFileSync(path.join(target, 'review-board.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>动漫高手 · 全模块设计审查</title>
<style>body{margin:0;background:#faf9f7;color:#292523;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1440px;margin:auto;padding:24px}h1{font-size:28px;margin:0 0 12px}p{max-width:900px}label{display:block;font-weight:600}select{font:inherit;padding:10px;max-width:100%;margin:8px 0}a{color:#963b43}#pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:24px}article{background:white;border:1px solid #ddd7d1;padding:16px;border-radius:12px}article[hidden]{display:none}h2{font-size:18px;margin:0 0 8px}.note{min-height:110px}.shots{display:flex;gap:8px}.shots a{width:50%}.shots img{width:100%;height:auto;display:block}small{color:#655e59}</style>
<header><h1>动漫高手 · 全模块设计审查</h1><p>26个路由 · 19类模块 · 30组身份页面。当前整体统一性尚未通过。以下为本轮开发工具原始首尾画面，使用本地审查数据；这是审查基线，不是已完成的改版。点击图片查看原图。</p><p><a href="REVIEW-2026-09-09.md">完整设计决定与整改顺序</a> · <a href="INVENTORY.md">功能模块清单</a></p><label for="module">按功能模块对比所有关联页面</label><select id="module"><option value="">全部模块</option>${catalog.modules.map(module => `<option value="${escape(module.id)}">${escape(module.name)}</option>`).join('')}</select><p id="count" aria-live="polite">当前显示 ${rows.length} 组页面</p></header>
<main id="pages">${rows.map(row => `<article data-modules="${escape(row.modules.join(' '))}"><h2>${escape(row.name)} · ${row.role === 'provider' ? '服务方' : '需求方'}</h2><small>${escape(row.route)}${row.actualRoute !== row.route ? ' → ' + escape(row.actualRoute) : ''}</small><p class="note">${escape(row.note)}</p><div class="shots">${['top','bottom'].map(position => `<a href="${imagePath(row.id,position)}"><img loading="lazy" src="${imagePath(row.id,position)}" alt="${escape(row.name)} ${position === 'top' ? '顶部' : '末尾'}"><span>${position === 'top' ? '顶部' : '滚动末尾'}</span></a>`).join('')}</div></article>`).join('')}</main>
<script>document.querySelector('#module').addEventListener('change',function(){let count=0;document.querySelectorAll('article').forEach(card=>{card.hidden=!!this.value&&!card.dataset.modules.split(' ').includes(this.value);if(!card.hidden)count++;});document.querySelector('#count').textContent='当前显示 '+count+' 组页面';});</script></html>`);
console.log(`审查索引与对照板已生成：${catalog.pages.length}路由，${catalog.modules.length}模块，${rows.length}组页面。`);
