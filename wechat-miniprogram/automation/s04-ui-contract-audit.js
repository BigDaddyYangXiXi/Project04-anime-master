const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pageRoot = path.resolve(__dirname, "..", "miniprogram", "pages", "provider-request");
const wxml = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
const js = fs.readFileSync(path.join(pageRoot, "index.js"), "utf8");

assert.ok(!wxss.includes("> * + *"), "WXSS 不得使用微信编译器不支持的通配子节点选择器");
assert.strictEqual((wxml.match(/class="contact-action"/g) || []).length, 3, "复制和拨打必须复用三个紧凑行内操作实例");
assert.ok(/\.contact-action[^}]*min-height:\s*88rpx[^}]*border:\s*1rpx solid #e7deda[^}]*border-radius:\s*16rpx/s.test(wxss), "行内操作必须保留 44px 热区、暖灰细边和 8px 圆角");
assert.ok(/\.contact-action[^}]*color:\s*#b64f1f[^}]*font-size:\s*24rpx[^}]*font-weight:\s*500[^}]*line-height:\s*36rpx/s.test(wxss), "行内操作文字必须使用 12/18 Medium 橙色层级");
assert.ok(wxml.includes('class="secondary-block quote-action"'), "报价确认必须保持品牌副按钮身份");
assert.ok(wxml.includes('wx:if="{{!order.priceEdited && quoteChanged}}"') && wxml.includes("当前报价可直接用于本次合作"), "未改价时必须显示说明而不是无效按钮，仅改价后出现锁价操作");
assert.ok(/\.quote-action[^}]*font-size:\s*28rpx[^}]*font-weight:\s*500[^}]*line-height:\s*40rpx/s.test(wxss), "报价确认必须使用 14/20 Medium 按钮文字");
assert.ok(/page button\.quote-action\[disabled\][^}]*opacity:\s*\.62/.test(wxss), "长文案报价按钮禁用时必须保持文字可读");
assert.strictEqual((wxml.match(/class="confirm-line/g) || []).length, 3, "时间地点、服务内容和合作金额必须复用同一确认行组件");
assert.ok(["地点与时间确认", "服务内容确认", "保密需求确认", "合作金额确认"].every(text => wxml.includes(`<text>${text}</text>`)), "四项确认必须使用明确的用户语义");
assert.ok(["1", "2", "3", "4"].every(index => wxml.includes(`>${index}</text>`)), "四项确认未完成时必须显示 1‑4 序号");
assert.ok(js.includes("新报价尚未锁定，请先确认逐项报价") && js.includes("沿用当前报价，核对后可直接确认"), "第 4 项必须区分沿用当前报价与新报价待锁定");
assert.ok(wxml.includes("合作确立，提交确认") && wxml.includes("合作不确立"), "结果操作必须使用明确的合作语义");
assert.ok(wxml.includes("沟通结果 · 合作条件") && wxml.includes("逐项落定这次合作") && wxml.includes("避免双方理解不一致"), "服务方确认区必须复用需求方的元信息、主标题、导语三层节奏");
assert.ok(/\.completion-list[^}]*border:\s*1rpx solid #e7deda[^}]*border-radius:\s*28rpx/s.test(wxss), "四项确认必须共享暖灰细边和 14px 外圆角");
assert.ok(/\.confirm-line[^}]*border:\s*0[^}]*border-radius:\s*0/s.test(wxss), "确认行不得各自绘制独立卡片边框和圆角");
assert.ok(/\.confirmation-copy[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*justify-content:\s*center[^}]*text-align:\s*left/s.test(wxss), "四项文字组必须在热区中纵向居中并保持语义左对齐");
assert.ok(/\.confirm-line \.confirmation-copy text:first-child[^}]*font-size:\s*29rpx[^}]*font-weight:\s*700[^}]*line-height:\s*42rpx/s.test(wxss), "确认行主文字必须使用更明确的标题层级");
assert.ok(/\.confirm-line \.confirmation-copy text:last-child[^}]*font-size:\s*23rpx[^}]*line-height:\s*38rpx/s.test(wxss), "确认行说明必须保持比标题弱一级的阅读节奏");
assert.ok(/\.confirmation-state[^}]*min-width:\s*104rpx[^}]*border-radius:\s*999rpx[^}]*font-size:\s*19rpx/s.test(wxss), "待确认／已确认必须使用统一状态胶囊，不使用第二个空圆");
assert.ok(/\.amount-editor\s*\{[^}]*padding:\s*0 22rpx 24rpx[^}]*\}/s.test(wxss) && !/\.quote-panel\s*\{[^}]*border-left:/s.test(wxss), "金额编辑区必须左右等距，不得使用无语义的单边强调线");
assert.ok(wxml.includes('class="nda-segments"'), "NDA 必须使用连续二选一分段容器");
const ndaSegmentsRule = wxss.match(/\.nda-choice > \.nda-segments\s*\{([^}]*)\}/s);
assert.ok(ndaSegmentsRule && /gap:\s*0/.test(ndaSegmentsRule[1]) && /border:\s*1rpx solid #e7deda/.test(ndaSegmentsRule[1]) && /overflow:\s*hidden/.test(ndaSegmentsRule[1]), "NDA 分段必须零间距、共享暖灰外框并裁切统一圆角");
assert.ok(/button\.active::after[^}]*width:\s*48rpx[^}]*height:\s*4rpx[^}]*background:\s*#ff6f71/s.test(wxss), "NDA 选中态必须使用 24x2px 珊瑚短线");
assert.ok(/\.nda-choice \.nda-segments button[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center/s.test(wxss), "NDA 分段文字必须显式双轴居中");
assert.ok(/\.primary-block, \.secondary-block, \.danger-block, \.upload-button[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center/s.test(wxss), "S04 主副危险按钮必须统一显式双轴居中");

assert.ok(wxml.includes('class="page-intro evaluation-intro"') && wxml.includes('class="page-intro contact-intro"'), "评估态与沟通态必须先解释当前服务方任务");
assert.ok(wxml.includes('class="contact-method"') && !wxml.includes('class="contact-row'), "联系方式必须使用操作块而不是字段表格");
assert.ok(wxml.includes("buyerIdentity.nickname") && wxml.includes("buyerIdentity.uid"), "服务方必须读取需求方昵称与 UID，不得把联系人称呼冒充账号身份");
assert.ok(wxml.includes("schedule.lines") && wxml.includes("order.city"), "地点必须先于结构化时间展示，并支持多个时段逐行显示");

process.stdout.write("S04 UI contract audit: 30 assertions passed\n");
