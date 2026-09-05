const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wxml = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/work-detail/index.wxml"), "utf8");
const wxss = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/work-detail/index.wxss"), "utf8");
const js = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/work-detail/index.js"), "utf8");
let definition = null;
let followedIds = [];

global.Page = (value) => { definition = value; };
global.wx = {
  getStorageSync() { return followedIds; },
  setStorageSync(key, value) { followedIds = value; },
  showToast() {}
};

require("../miniprogram/pages/work-detail/index.js");
const page = { data: Object.assign({}, definition.data, { work: { provider: { id: 1 } }, followed: false }) };
Object.keys(definition).forEach((key) => {
  if (typeof definition[key] === "function") page[key] = definition[key].bind(page);
});
page.setData = (patch) => Object.assign(page.data, patch);

page.toggleFollow();
assert.strictEqual(page.data.followed, true, "关注操作必须更新当前状态");
assert.deepStrictEqual(followedIds, [1], "关注操作必须保留既有持久化行为");
page.toggleFollow();
assert.strictEqual(page.data.followed, false, "再次点击必须取消关注");
assert.deepStrictEqual(followedIds, [], "取消关注必须移除持久化关系");

assert.ok(!wxml.includes("{{work.provider.career}}作品 · {{work.code}}"), "作品码不得与职业拼成顶部开发代号");
assert.ok(wxml.includes("class=\"work-code-bar\"") && wxml.includes("{{work.code}}") && wxml.includes("bindtap=\"copyCode\""), "面向用户的作品码横栏必须保留，并提供复制入口");
assert.ok(wxml.indexOf("class=\"work-code-bar\"") > wxml.indexOf("class=\"work-image-stack\""), "作品码横栏必须位于完整图片流之后");
assert.ok(wxml.includes("class=\"copy-glyph\"") && /\.code-copy-button\s*\{[^}]*linear-gradient\([^}]*padding-box[^}]*linear-gradient\([^}]*border-box/s.test(wxss), "复制按钮必须保留原完整图形与彩虹细边样式");
assert.ok(js.includes("copyCode()") && js.includes("setClipboardData"), "作品码横栏的复制操作必须真实可用");
assert.ok(!/[♡♥]/.test(wxml), "关注控件不得使用字体字符冒充图标");
assert.ok(wxml.includes("follow-icon") && wxml.includes("/assets/actions/follow.svg") && wxml.includes("/assets/actions/follow-active.svg"), "关注控件必须使用品牌同源矢量图标并覆盖双状态");
assert.ok(/\.follow-button\s*\{[^}]*display:\s*flex[^}]*min-height:\s*88rpx[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*border:\s*0[^}]*background:\s*transparent/s.test(wxss), "关注控件必须在 44px 热区内与身份行双轴对齐且不使用随意卡片表面");
assert.ok(/\.follow-icon\s*\{[^}]*width:\s*60rpx[^}]*height:\s*60rpx/s.test(wxss), "关注图标必须使用与底栏一致的 30px 主视觉尺寸");
assert.ok(/\.work-image-stack\s*\{[^}]*gap:\s*0[^}]*margin-right:\s*-28rpx[^}]*margin-left:\s*-28rpx/s.test(wxss), "作品图片流必须左右贴边并纵向连续");
assert.ok(/\.work-figure-card\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/s.test(wxss), "作品图片不得使用卡片圆角或阴影");
assert.ok(!wxml.includes("detail-orbit") && !wxss.includes(".detail-orbit"), "作品图片不得叠加无业务含义的圆形装饰边框");
assert.ok(/\.sticky-action button\s*\{[^}]*#f0787e[^}]*#ee8f88[^}]*#e77c90/s.test(wxss), "预约主操作按钮必须保持既有配色不变");

process.stdout.write("B02W user-facing detail contract audit: 17 assertions passed\n");
