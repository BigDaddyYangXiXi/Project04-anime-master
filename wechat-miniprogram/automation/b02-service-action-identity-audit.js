const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "miniprogram", "pages", "provider-detail");
const wxml = fs.readFileSync(path.join(root, "index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "index.wxss"), "utf8");
const js = fs.readFileSync(path.join(root, "index.js"), "utf8");

assert.ok(/class="service-select" role="checkbox" aria-checked=/.test(wxml), "选择必须使用可访问复选控件");
assert.ok(/class="service-check-mark/.test(wxml), "选择必须使用独立复选标记");
assert.ok(/class="service-expand" role="button" aria-expanded=/.test(wxml), "详情必须使用可访问披露入口");
assert.ok(/class="service-chevron/.test(wxml), "详情必须包含方向箭头");
assert.ok(!/class="service-check"/.test(wxml), "不得保留与详情同形的旧选择按钮");
assert.ok(/\.service-check-mark\s*\{[^}]*border:/s.test(wxss), "复选标记必须有独立视觉边界");
assert.ok(/\.service-expand\s*\{[^}]*color:/s.test(wxss), "详情必须使用文字披露视觉");
assert.ok(!/\.service-select[^}]*border-radius:[^}]*background:/s.test(wxss), "选择不得重新画成整块圆角按钮");
assert.ok(/toggleService[\s\S]*selected:\s*!service\.selected/.test(js), "选择操作只切换 selected");
assert.ok(/toggleExpand[\s\S]*expanded:\s*!service\.expanded/.test(js), "详情操作只切换 expanded");

process.stdout.write("B02 service action identity audit: 10 assertions passed\n");
