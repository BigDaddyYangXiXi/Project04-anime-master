const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

const discoverWxml = read("miniprogram/pages/discover/index.wxml");
const discoverWxss = read("miniprogram/pages/discover/index.wxss");
const discoverJson = JSON.parse(read("miniprogram/pages/discover/index.json"));
const searchResultsWxml = read("miniprogram/pages/search-results/index.wxml");
const searchResultsWxss = read("miniprogram/pages/search-results/index.wxss");
const workCardWxml = read("miniprogram/components/work-card/index.wxml");
const workCardWxss = read("miniprogram/components/work-card/index.wxss");

let pageDefinition = null;
global.wx = {
  getStorageSync() { return ""; },
  removeStorageSync() {},
  navigateTo() {}
};
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/discover/index.js");

const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)), discovery: JSON.parse(JSON.stringify(pageDefinition.discovery)) };
Object.keys(pageDefinition).forEach((key) => {
  if (key !== "data" && key !== "discovery" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
});
page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
page.onLoad({ audit: "1" });

assert.strictEqual(page.data.careerTabs.length, 4, "必须保留四个职业入口");
assert.deepStrictEqual(page.data.careerTabs[0].letters, ["妆", "娘"], "职业文字必须提供逐字设计数据");
assert.ok(page.data.visibleWorks.length > 0 && page.data.visibleWorks.every((work) => work.provider.career === "妆娘"), "默认结果必须属于默认职业");
page.chooseCareer({ currentTarget: { dataset: { career: "摄影" } } });
assert.strictEqual(page.data.career, "摄影", "职业入口必须保持真实切换行为");
assert.ok(page.data.visibleWorks.length > 0 && page.data.visibleWorks.every((work) => work.provider.career === "摄影"), "切换后结果不得串职业");
page.openSearch();
assert.strictEqual(page.data.searchOpen, true, "整条搜索栏点击后必须打开搜索浮层");

assert.ok(/class="career-search browse-control"\s+bindtap="openSearch"/.test(discoverWxml), "整条搜索栏必须保留唯一点击入口");
assert.ok(!discoverWxml.includes("search-action"), "搜索栏最右侧不得保留独立搜索按钮");
assert.ok(/class="career-search browse-control"\s+bindtap="openSearch"/.test(searchResultsWxml) && !searchResultsWxml.includes("search-action"), "搜索结果页也必须使用整栏唯一点击入口");

// The 2026-09-10 discovery contract replaces the old coral, decorated-label layout.
const controlStyles = read('miniprogram/styles/discovery-controls.wxss');
for (const source of [discoverWxss, searchResultsWxss]) {
  assert.ok(source.includes('../../styles/discovery-controls.wxss'), '搜索与筛选必须导入共享排版');
}
assert.ok(controlStyles.includes('var(--am-weight-regular)'), '选项必须使用常规字重');
const sequence = ['class="location-priority"', 'class="career-section"', 'class="career-search browse-control"', 'class="discovery-toolbar"', 'class="where-when-row"'];
for(let i=1;i<sequence.length;i++) assert.ok(discoverWxml.indexOf(sequence[i-1]) < discoverWxml.indexOf(sequence[i]), '城市日期、职业、搜索、浏览类型、筛选的优先级必须保持');
assert.ok(discoverWxml.includes('mode="region"') && discoverWxml.includes('mode="date"'), '城市日期保留原生选择器');
assert.ok(discoverWxml.includes('data-kind="style"') && discoverWxml.includes('data-kind="price"'), '风格和价格必须独立打开');
assert.ok(discoverWxml.includes('bindtouchend="onCareerTouchEnd"') && discoverWxml.includes('career-scroll-spacer'), '职业停靠保留拖动结束入口和末尾对齐空间');
for(const career of page.data.careerTabs) assert.ok(career.asset.endsWith('-cutout.svg'), '沿用原角色透明轮廓');
page.data.selectedFilters=['电影光','￥1000以下'];
page.openFilters({currentTarget:{dataset:{kind:'style'}}});
page.resetFilters(); assert.deepStrictEqual(page.data.filterDraft,['￥1000以下'], '风格重置不影响价格');
page.closeFilters(); assert.deepStrictEqual(page.data.selectedFilters,['电影光','￥1000以下'], '取消不提交草稿');
page.openFilters({currentTarget:{dataset:{kind:'price'}}});
assert.ok(page.data.availableFilterGroups.every(g=>g.group==='价格区间'), '价格弹窗不得混入风格');
assert.ok(workCardWxml.includes('class="work-price am-money am-money-list"'), '价格必须是独立节点');
assert.ok(workCardWxml.indexOf('work-author') < workCardWxml.indexOf('work-title'), '先作者后标题');
assert.ok(workCardWxml.startsWith('<navigator') && workCardWxml.includes('source={{source}}'), '保留作品原生导航与来源');
assert.ok(discoverWxml.includes('source="B01"') && !discoverWxml.includes('bind:open="openWork"'), '首页作品单击进入详情');
assert.strictEqual(discoverJson.navigationBarTitleText,'动漫高手');
process.stdout.write('B01 当前检索布局与行为契约通过\n');
