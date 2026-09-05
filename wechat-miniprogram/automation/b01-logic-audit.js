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

assert.ok(/class="career-search"\s+bindtap="openSearch"/.test(discoverWxml), "整条搜索栏必须保留唯一点击入口");
assert.ok(!discoverWxml.includes("search-action"), "搜索栏最右侧不得保留独立搜索按钮");
assert.ok(/class="career-search"\s+bindtap="openSearch"/.test(searchResultsWxml) && !searchResultsWxml.includes("search-action"), "搜索结果页也必须使用整栏唯一点击入口");
for (const [name, source] of [["B01", discoverWxss], ["B01S", searchResultsWxss]]) {
  assert.ok(/\.search-icon\s*\{[^}]*width:\s*40rpx[^}]*min-width:\s*40rpx[^}]*max-width:\s*40rpx[^}]*height:\s*36rpx[^}]*flex:\s*0 0 40rpx/s.test(source), `${name} 搜索图标必须使用不可压缩的固定占位盒`);
  assert.ok(/\.search-icon::before\s*\{[^}]*width:\s*30rpx[^}]*height:\s*30rpx[^}]*border:\s*4rpx solid #ff6f71[^}]*border-radius:\s*50%/s.test(source), `${name} 放大镜圆环必须保持 30×30rpx 正圆`);
  assert.ok(/\.career-search > text:nth-child\(2\)\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1/s.test(source), `${name} 搜索文字必须收缩而不能挤压图标`);
  assert.ok(/\.modal-search\s*\{[^}]*height:\s*72rpx[^}]*padding:\s*4rpx 18rpx[^}]*border:\s*1rpx solid #f2cfd3[^}]*border-radius:\s*24rpx/s.test(source), `${name} 搜索浮层必须复用首页搜索框的高度、内边距、边框和圆角`);
  assert.ok(/\.modal-search input\s*\{[^}]*font-size:\s*24rpx[^}]*line-height:\s*36rpx[^}]*font-weight:\s*400/s.test(source), `${name} 搜索浮层输入文字必须复用首页 12/18 Regular`);
  assert.ok(/\.recent-item::before\s*\{[^}]*top:\s*16rpx[^}]*bottom:\s*16rpx[^}]*border-radius:\s*28rpx/s.test(source), `${name} 最近搜索可见框体必须缩至 28px 并保留 44px 热区`);
  assert.ok(/\.recent-item\s*\{[^}]*width:\s*auto[^}]*flex:\s*0 0 auto/s.test(source), `${name} 最近搜索必须按内容宽度排列，不能扩展为半屏列表行`);
  assert.ok(/\.recent-item button\s*\{[^}]*display:\s*flex[^}]*height:\s*88rpx[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*font-size:\s*22rpx[^}]*font-weight:\s*400/s.test(source), `${name} 最近搜索文字必须双轴居中并保留 44px 热区`);
  assert.ok(/\.modal-actions \.primary-button\s*\{[^}]*flex:\s*1\.5[^}]*linear-gradient\(135deg,#f0787e,#ee8f88 52%,#e77c90\)/s.test(source), `${name} 查看结果必须复用产品主操作渐变`);
}
assert.ok(/\.discovery-toolbar button\s*\{[^}]*display:\s*flex[^}]*height:\s*72rpx[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*0 10rpx/s.test(discoverWxss), "三个检索分段的文字必须在 36px 按钮内双轴居中");
assert.ok(/class="secondary-button"\s+bindtap="closeSearch"[^>]*>取消<\/button><button class="primary-button"/s.test(discoverWxml), "B01 搜索浮层必须使用产品主副按钮组件");
assert.ok(/class="secondary-button"\s+bindtap="closeSearch"[^>]*>取消<\/button><button class="primary-button"/s.test(searchResultsWxml), "B01S 搜索浮层必须使用产品主副按钮组件");
assert.ok(discoverWxml.includes("career-letter"), "四职业名称必须恢复逐字设计结构");
assert.ok(discoverWxss.includes(".career-label::before") && discoverWxss.includes(".career-label::after"), "职业标签必须恢复两侧装饰点");
assert.ok(workCardWxml.includes("class=\"work-tags\""), "作品标签必须使用独立容器");
assert.ok(workCardWxml.includes("class=\"work-price\""), "价格必须是独立节点");
assert.ok(!workCardWxml.includes("topTagsText}} ·"), "标签与价格不得拼接为同一文本");
assert.ok(workCardWxml.indexOf("work-author") < workCardWxml.indexOf("work-title"), "作品卡信息层级必须先作者、后标题");
assert.ok(!workCardWxml.includes("work-subtitle"), "作品卡不得重复显示已经由标签表达的副标题");
assert.ok(/\.work-tag\s*\{[^}]*background:/s.test(workCardWxss), "每个作品标签必须有独立底色");
assert.ok(/\.work-price\s*\{[^}]*font-size:\s*28rpx/s.test(workCardWxss), "价格必须使用独立 14px 字级");
assert.ok(/\.provider-price\s*\{[^}]*color:\s*#c6536b/s.test(discoverWxss), "服务者卡价格必须复用统一莓果珊瑚强调色");
assert.ok(workCardWxml.startsWith("<navigator"), "作品卡必须使用原生单击导航，不经过二次自定义事件链");
assert.ok(workCardWxml.includes("open-type=\"navigate\"") && workCardWxml.includes("source={{source}}"), "作品卡必须单击进入带来源的作品详情");
assert.ok(discoverWxml.includes('source="B01"') && !discoverWxml.includes('bind:open="openWork"'), "首页作品卡必须直接单击进入详情");
assert.strictEqual(discoverJson.navigationBarTitleText, "动漫高手", "首页顶部必须显示产品名而不是业务入口名");
assert.ok(/\.hero-panel\s*\{[^}]*padding:\s*32rpx/s.test(discoverWxss), "首页主视觉必须使用 16px 恒定内边距并压缩高度");
assert.ok(/\.where-when-row\s*\{[^}]*gap:\s*16rpx[^}]*margin-top:\s*24rpx/s.test(discoverWxss) && /\.where-when-field > view\s*\{[^}]*min-height:\s*96rpx[^}]*padding:\s*8rpx 16rpx/s.test(discoverWxss), "地点日期区域必须使用 8/12px 节奏和 48px 紧凑控件");
assert.ok(/\.career-section\s*\{[^}]*padding:\s*24rpx 0 16rpx/s.test(discoverWxss), "职业区必须为外扩选中轮廓预留 12px 顶部和 8px 底部间距");
assert.ok(/\.career-row\s*\{[^}]*overflow:\s*visible/s.test(discoverWxss) && /\.career-chip\s*\{[^}]*overflow:\s*visible/s.test(discoverWxss) && !/\.career-chip\.active \.career-icon-shell\s*\{[^}]*translateY\(-/s.test(discoverWxss), "职业选中轮廓不得由父级裁切或向上偏移");

process.stdout.write("B01 UI contract audit: 48 assertions passed\n");
