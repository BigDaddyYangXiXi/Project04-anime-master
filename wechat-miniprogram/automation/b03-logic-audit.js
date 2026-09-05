const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RealDate = Date;
const auditNow = new RealDate("2026-08-19T12:00:00+08:00").getTime();
global.Date = class FixedAuditDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [auditNow]));
  }

  static now() { return auditNow; }
};

const bookingWxml = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/booking/index.wxml"), "utf8");
const bookingWxss = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/booking/index.wxss"), "utf8");
const bookingJs = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/booking/index.js"), "utf8");

const storage = new Map();
let pageDefinition = null;
let redirectedTo = "";

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast() {},
  redirectTo({ url }) { redirectedTo = url; },
  navigateTo({ url }) { redirectedTo = url; },
  chooseMedia() {}
};
global.Page = (definition) => { pageDefinition = definition; };

require("../miniprogram/pages/booking/index.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assignPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!cursor[parts[index]]) cursor[parts[index]] = {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function createPage(options) {
  const page = { data: clone(pageDefinition.data) };
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
  });
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => assignPath(page.data, key, patch[key]));
    if (callback) callback();
  };
  page.onLoad(Object.assign({ audit: "1" }, options));
  return page;
}

const defaultPage = createPage({ providerId: "1", workId: "w-mu-1" });
assert.ok(bookingWxml.includes('class="segmented-control time-mode-control"'), "三种时间模式必须使用连续分段选择器");
assert.ok(!bookingWxml.includes("连续多日"), "连续多日不得继续作为重复的独立模式展示");
assert.ok(!bookingJs.includes('{ id: "multi-day"'), "连续多日不得继续进入可选模式数据");
assert.ok(/\.time-mode-control\s*\{[^}]*repeat\(3,/s.test(bookingWxss), "时间选择器必须使用三等分布局");
assert.ok(bookingWxml.includes('class="segmented-control reference-mode-control"'), "引用作品与上传图片必须复用同一分段选择器语言");
assert.ok(/\.segmented-control\s*\{[^}]*gap:\s*0/s.test(bookingWxss), "分段选择器必须连续且没有分段间距");
assert.ok(/\.segmented-control button\s*\{[^}]*display:\s*flex[^}]*min-height:\s*88rpx[^}]*align-items:\s*center[^}]*justify-content:\s*center/s.test(bookingWxss), "分段选项必须保留 44px 热区并双轴居中文字");
assert.ok(/\.segment-surface\s*\{[^}]*height:\s*72rpx[^}]*#e7deda[^}]*font-size:\s*24rpx/s.test(bookingWxss), "44px 热区内必须使用 36px 暖灰边视觉表面和 12px 文字");
assert.ok(/\.segment-indicator\s*\{[^}]*bottom:\s*4rpx[^}]*width:\s*48rpx[^}]*height:\s*4rpx[^}]*#ff6f71/s.test(bookingWxss), "选中态必须使用首页同源的 24x2px 珊瑚短线");
assert.ok(/\.service-section-title \.section-price\s*\{[^}]*min-width:\s*120rpx[^}]*text-align:\s*right[^}]*tabular-nums/s.test(bookingWxss), "预约总价必须使用固定宽度、等宽数字和右对齐");
assert.ok(/\.service-option\.selected\s*\{[^}]*margin:\s*0[^}]*padding:\s*16rpx/s.test(bookingWxss), "服务选中态不得改变行宽或内边距");
assert.ok(/\.service-price\s*\{[^}]*min-width:\s*104rpx[^}]*tabular-nums[^}]*text-align:\s*right/s.test(bookingWxss), "服务项价格列必须保持固定位置");
assert.ok(!/\.mode-row|\.reference-tabs/.test(bookingWxss), "旧的大块按钮样式不得残留");
assert.ok(bookingWxml.includes('disabled="{{submitting}}" aria-disabled="{{!canSubmit}}"'), "业务缺项时主按钮仍须可点击并解释原因，仅提交中原生禁用");
assert.ok(bookingWxml.includes('class="required-dot"'), "未完成必填分组必须显示红点");
assert.ok(bookingJs.includes("provider.works.find((item) => item.id === requestedWorkId)"), "B03 必须优先解析服务者自己的已发布作品");
assert.ok(bookingJs.includes("catalogWork.provider.id === provider.id"), "B03 必须拒绝跨服务者作品引用");
assert.ok(bookingJs.includes("作品与服务者不匹配"), "跨服务者作品引用必须给出明确反馈");
assert.ok(bookingJs.includes("wx.navigateTo({ url: `/pages/booking-status/index?id=${order.id}`"), "进入 B04 时必须保留 B03 页面栈");
assert.ok(!bookingJs.includes("wx.redirectTo({ url: `/pages/booking-status/index"), "进入 B04 不得替换 B03");
assert.ok(bookingJs.includes("if (this.submittedOrderId && this.data.submitting)"), "从 B04 返回时必须恢复 B03 提交控件");
assert.strictEqual(defaultPage.data.canSubmit, false, "空联系方式与空需求必须禁用提交");
assert.strictEqual(defaultPage.data.referenceMode, "work", "从作品进入应默认引用作品");
assert.strictEqual(defaultPage.data.displayedTotal, 520, "默认服务合计应为 520");
assert.ok(defaultPage.data.date >= new Date().toISOString().slice(0, 10), "默认日期不得早于今天");

const validPage = createPage({ providerId: "1", workId: "w-mu-1", fixture: "valid" });
assert.strictEqual(validPage.data.canSubmit, true, "完整有效草稿应允许提交");
assert.strictEqual(validPage.data.validationIssues.length, 0, "完整有效草稿不得残留缺项提示");
assert.strictEqual(validPage.referenceSummary(), "夜航者 · AM-MU-3H8KP");

validPage.toggleService({ currentTarget: { dataset: { id: "makeup-follow" } } });
assert.strictEqual(validPage.data.displayedTotal, 880, "多选服务合计应为 880");
assert.strictEqual(validPage.data.selectedServiceText, "角色妆造 + 现场跟妆");

const conflictPage = createPage({ providerId: "1", workId: "w-mu-1", fixture: "valid", conflict: "1", audit: "1" });
assert.strictEqual(conflictPage.data.canSubmit, false, "包含满客日期必须禁用提交");
assert.ok(conflictPage.data.timeError.includes("满客"), "满客冲突必须归入时间字段并给出明确提示");

const legacyMultiDayPage = createPage({ providerId: "1", mode: "multi-day", fixture: "valid" });
assert.strictEqual(legacyMultiDayPage.data.timeMode, "continuous", "旧连续多日链接必须兼容映射到连续时段");
assert.ok(legacyMultiDayPage.data.endDate > legacyMultiDayPage.data.startDate, "旧连续多日链接必须保留跨日时间范围");

defaultPage.submitBooking();
assert.strictEqual(defaultPage.data.showValidationErrors, true, "点击受限主按钮后必须展开缺项原因");
assert.ok(defaultPage.data.validationIssues.includes("填写联系人称呼"), "缺项列表必须精确指出联系人称呼");

const pastPage = createPage({ providerId: "1", fixture: "valid" });
pastPage.updateStartDate({ detail: { value: "2000-01-01" } });
assert.strictEqual(pastPage.data.canSubmit, false, "过去的开始日期不得提交");
assert.ok(pastPage.data.timeError.includes("不能早于"), "过去时间必须给出明确提示");

const crossMonthPage = createPage({ providerId: "1", fixture: "valid", date: "2026-09-21" });
assert.strictEqual(crossMonthPage.data.canSubmit, true, "其他月份的同一日号不得误判为 8 月满客日");

const overlapPage = createPage({ providerId: "1", fixture: "valid", mode: "segments" });
overlapPage.addSegment();
overlapPage.updateSegment({ currentTarget: { dataset: { id: overlapPage.data.segments[1].id, key: "startTime" } }, detail: { value: "07:00" } });
assert.strictEqual(overlapPage.data.canSubmit, false, "互相重叠的多个时段不得提交");
assert.ok(overlapPage.data.timeError.includes("不能互相重叠"), "重叠时段必须给出明确提示");

validPage.submitBooking();
assert.ok(redirectedTo.startsWith("/pages/booking-status/index?id=AM-"), "提交后应进入预约状态页");
const savedOrders = storage.get("anime-master-v063-orders");
assert.ok(Array.isArray(savedOrders) && savedOrders[0].finalPrice === 880, "提交订单必须保存联动后的最终金额");
assert.strictEqual(savedOrders[0].reference, "夜航者 · AM-MU-3H8KP");
assert.deepStrictEqual(savedOrders[0].serviceItems.map((item) => item.displayPrice), [520, 360], "订单必须保存逐服务项价格快照");
assert.deepStrictEqual(savedOrders[0].bookingDraft.serviceIds, ["makeup", "makeup-follow"], "订单必须保存可再次发起的结构化预约草稿");
savedOrders[0].stage = "DECLINED";
storage.set("anime-master-v063-orders", savedOrders);
const repeatPage = createPage({ providerId: "1", repeatOrderId: savedOrders[0].id });
assert.strictEqual(repeatPage.data.note, validPage.data.note, "沟通未达成后必须带回原需求说明");
assert.deepStrictEqual(repeatPage.data.contact, validPage.data.contact, "沟通未达成后必须带回原联系方式");
assert.deepStrictEqual(repeatPage.data.selectedServices.map((item) => item.id), ["makeup", "makeup-follow"], "沟通未达成后必须带回原服务项");
const orderCount = savedOrders.length;
validPage.onShow();
assert.strictEqual(validPage.data.submitting, false, "从 B04 返回 B03 后必须恢复提交控件");
validPage.submitBooking();
assert.strictEqual(storage.get("anime-master-v063-orders").length, orderCount, "重复点击不得生成重复订单");
assert.ok(redirectedTo.includes(validPage.submittedOrderId), "返回 B03 后再次点击只能回到同一预约状态记录");

process.stdout.write("B03 logic, required-feedback, segmented-control, price-position, repeat-draft, and return-stack audit: 50 assertions passed\n");
