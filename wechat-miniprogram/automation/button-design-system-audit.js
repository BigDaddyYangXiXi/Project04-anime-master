const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const appStyles = fs.readFileSync(path.join(projectRoot, "miniprogram/app.wxss"), "utf8");
const pagesRoot = path.join(projectRoot, "miniprogram/pages");

function collectFiles(directory, extension, result = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(target, extension, result);
    else if (entry.name.endsWith(extension)) result.push(target);
  });
  return result;
}

const wxmlFiles = collectFiles(pagesRoot, ".wxml");
const wxssFiles = collectFiles(pagesRoot, ".wxss");
const retiredFixturePages = new Set(["provider-home", "provider-calendar"]);
const secondaryInstances = wxmlFiles.reduce((total, file) => {
  if (retiredFixturePages.has(path.basename(path.dirname(file)))) return total;
  const source = fs.readFileSync(file, "utf8");
  return total + (source.match(/class="[^"]*secondary-(?:block|button)[^"]*"/g) || []).length;
}, 0);
const primaryInstances = wxmlFiles.reduce((total, file) => {
  const source = fs.readFileSync(file, "utf8");
  return total + (source.match(/class="[^"]*primary-(?:block|button)[^"]*"/g) || []).length;
}, 0);

assert.strictEqual(secondaryInstances, 18, "生产页面应有 18 个明确标注的副操作实例；退役路由夹具、列表导航和清除类三级操作不得计入");
const discoverMarkup = fs.readFileSync(path.join(pagesRoot, "discover/index.wxml"), "utf8");
const searchResultsMarkup = fs.readFileSync(path.join(pagesRoot, "search-results/index.wxml"), "utf8");
const authMarkup = fs.readFileSync(path.join(pagesRoot, "auth/index.wxml"), "utf8");
assert.strictEqual((discoverMarkup.match(/class="secondary-button"/g) || []).length, 5, "共享首页的 B01 搜索／筛选和 S01 工作台副操作必须使用全局副按钮");
assert.strictEqual((searchResultsMarkup.match(/class="secondary-button"/g) || []).length, 1, "B01S 搜索取消必须使用全局副按钮");
assert.strictEqual((authMarkup.match(/class="secondary-button phone-button/g) || []).length, 1, "登录注册页的手机号入口必须复用全局副按钮");
assert.ok(appStyles.includes("page button.secondary-block") && appStyles.includes("page button.secondary-button"), "副按钮必须由全局样式统一管理");
assert.ok(/page button\.secondary-block,\s*page button\.secondary-button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center/s.test(appStyles), "副按钮必须由全局规则显式双轴居中文字");
assert.ok(/color:\s*#b64f1f/.test(appStyles), "副按钮必须使用橙色前景");
assert.ok(/#fff9ed[^}]*#fff0d8[^}]*padding-box/s.test(appStyles), "副按钮必须使用奶油黄至浅桃内容面");
assert.ok(/#fbc5c4[^}]*#fbbfd2[^}]*border-box/s.test(appStyles), "副按钮必须使用首页同源彩虹轮廓");
assert.ok(/secondary-block\[disabled\][^}]*box-shadow:\s*none[^}]*opacity:\s*0\.42/s.test(appStyles), "副按钮禁用态必须移除阴影并降低对比");
assert.ok(!/page button\.primary-(?:block|button)[^{]*\{[^}]*#fff9ed/s.test(appStyles), "全局副按钮规则不得覆盖主操作");
assert.ok(primaryInstances > 0, "生产页面必须存在可审计的主操作实例");
assert.ok(/page button\.danger-block\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center[^}]*box-shadow:\s*none/s.test(appStyles), "危险按钮必须显式双轴居中且无阴影");
assert.ok(
  /page button\.primary-block,\s*page button\.primary-button,\s*page \.sticky-action button,\s*page \.action-state button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s.test(appStyles),
  "主操作必须由全局规则显式双轴居中文字，不得依赖微信原生按钮的默认行框分配"
);

[path.join(projectRoot, "miniprogram/app.wxss"), ...wxssFiles].forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    if (!/\.primary-(?:block|button)\b|\.sticky-action\s+button\b|\.action-state\s+button\b/.test(selector)) continue;
    const shadow = match[2].match(/box-shadow\s*:\s*([^;}]+)/);
    assert.ok(!shadow || shadow[1].trim() === "none", `${path.relative(projectRoot, file)} 的重要按钮仍带有阴影`);
  }
});

wxssFiles.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  const pattern = /\.secondary-(?:block|button)(?:\[[^\]]+\])?\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    assert.ok(!/(?:^|;)\s*(?:color|background|border|box-shadow)\s*:/m.test(match[1]), `${path.relative(projectRoot, file)} 仍在覆盖全局副按钮配色`);
  }
});

process.stdout.write(`Product button design-system audit: shadow-free ${primaryInstances} primary instances and 18 secondary instances passed\n`);
