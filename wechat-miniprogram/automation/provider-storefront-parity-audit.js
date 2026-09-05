const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "miniprogram");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const detailWxml = read("pages", "provider-detail", "index.wxml");
const detailJs = read("pages", "provider-detail", "index.js");
const storefrontWxml = read("pages", "provider-profile", "index.wxml");
const buyerCalendarWxml = read("pages", "provider-schedule", "index.wxml");
const buyerCalendarWxss = read("pages", "provider-schedule", "index.wxss");
const providerCalendarWxml = read("pages", "provider-calendar", "index.wxml");
const providerCalendarWxss = read("pages", "provider-calendar", "index.wxss");
const detailWxss = read("pages", "provider-detail", "index.wxss");
const providerCalendarIcon = read("assets", "nav", "calendar.svg");
const providerWorkbenchIcon = read("assets", "nav", "workbench.svg");

[
  "provider.name", "provider.handle", "provider.career", "provider.city", "provider.bio", "provider.tags",
  "provider.services", "provider.notice", "provider.works", "availabilityDays", "noticeImage"
].forEach((binding) => assert.ok(detailWxml.includes(binding), `需求方详情缺少公开字段：${binding}`));
[
  "accountNickname", "profileDraft.city", "profileDraft.bio", "profileDraft.tags", "profileDraft.notice",
  "serviceDrafts", "workDrafts", "chooseNoticeImage"
].forEach((binding) => assert.ok(storefrontWxml.includes(binding), `服务方橱窗缺少编辑入口：${binding}`));
[
  "store.getProfile()", "store.getServices()", "store.getWorks()", "store.getPinnedWorkIds()", "store.getNoticeImage()", "store.getAvailableDays()"
].forEach((source) => assert.ok(detailJs.includes(source), `需求方详情未读取橱窗发布源：${source}`));
[buyerCalendarWxml, providerCalendarWxml].forEach((source) => {
  ["calendar-card", "week-row", "calendar-grid", "calendar-legend"].forEach((className) => assert.ok(source.includes(className), `月历缺少共享结构：${className}`));
});
[buyerCalendarWxss, providerCalendarWxss].forEach((source) => assert.ok(source.includes('@import "../../styles/availability-calendar.wxss"'), "月历未使用共享视觉规范"));
assert.ok(buyerCalendarWxml.includes("公开可约") && providerCalendarWxml.includes("公开可约"), "供需两侧公开状态文案不一致");
assert.ok(buyerCalendarWxml.includes("未公开") && providerCalendarWxml.includes("未公开"), "供需两侧未公开状态文案不一致");

const detailModuleLabels = ["个人历史数据", "预约前须知", "可预约服务", "服务评价", "公开档期", "公开作品"];
const detailModuleHeadings = detailModuleLabels.map((label) => `>${label}<`);
const detailModulePositions = detailModuleHeadings.map((heading) => detailWxml.indexOf(heading));
detailModulePositions.forEach((position, index) => assert.ok(position >= 0, `服务者详情缺少模块：${detailModuleLabels[index]}`));
for (let index = 1; index < detailModulePositions.length; index += 1) {
  assert.ok(detailModulePositions[index - 1] < detailModulePositions[index], `服务者详情模块顺序错误：${detailModuleLabels[index - 1]} 应位于 ${detailModuleLabels[index]} 之前`);
}
assert.ok(/\.profile-hero, \.section-card \{[^}]*margin-bottom: 18rpx;/s.test(detailWxss), "服务者详情模块间距必须统一为 18rpx");
assert.ok(/\.section-card \{ padding: 24rpx; \}/.test(detailWxss), "服务者详情卡片内边距必须统一为 24rpx");
assert.ok(/\.notice-image \{[^}]*height: 210rpx;/s.test(detailWxss), "预约须知配图高度必须保持紧凑");
assert.ok(providerCalendarIcon.includes('fill="#F28B78"'), "服务方档期图标主色必须向珊瑚主色收敛");
assert.ok(!providerCalendarIcon.includes('fill="#65d5bd"'), "服务方档期图标不得保留高占比绿色主填充");
[providerCalendarIcon, providerWorkbenchIcon].forEach((icon) => {
  assert.ok(icon.includes("#BFE5D8") && icon.includes("#F0BED1"), "服务方底栏图标应使用低饱和薄荷绿与粉色过渡");
});

process.stdout.write("Provider storefront parity audit passed\n");
