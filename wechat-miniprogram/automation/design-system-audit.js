const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "miniprogram");
const system = path.join(root, "design-system");
const read = (file) => fs.readFileSync(file, "utf8");
const catalog = JSON.parse(read(path.join(system, "catalog.json")));
const app = JSON.parse(read(path.join(source, "app.json")));
const normalize = (file) => file.replaceAll("\\", "/");
function tokenStyles(tokens) {
  return "/* Generated from design-system/tokens.json. */\npage, :host {\n" + Object.entries(tokens).map(([key, value]) => `  --am-${key}: ${value};`).join("\n") + "\n}\n";
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function actions(route) {
  const visited = new Set();
  function markup(file) {
    if (visited.has(file)) return "";
    visited.add(file);
    const content = read(file);
    return content + [...content.matchAll(/<(?:import|include)\s+src="([^"]+)"/g)].map((match) => markup(path.resolve(path.dirname(file), match[1]))).join("\n");
  }
  const content = markup(path.join(source, `${route}.wxml`));
  const names = [...content.matchAll(/(?:bind|catch)[\w:-]*="([\w]+)"/g)].map(match => match[1]);
  // Conditional disabling preserves the original action in the enabled branch.
  for (const match of content.matchAll(/(?:bind|catch)[\w:-]*="\{\{\([^"]+\) \? '' : '([\w]+)'\}\}"/g)) names.push(match[1]);
  return [...new Set(names)].sort();
}
function literals(file) {
  const result = {};
  const text = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /(?:^|[;{])\s*(font-size|font-weight|line-height|gap|row-gap|column-gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|border-radius|box-shadow|color|background(?:-color)?|min-height)\s*:\s*([^;}]+)/g;
  for (const match of text.matchAll(pattern)) {
    const remaining = match[2].replace(/var\(--am-[^)]+\)/g, "");
    if (match[2].includes("var(--am-") && !/[\d#]/.test(remaining)) continue;
    const key = `${match[1]}: ${match[2].trim().replace(/\s+/g, " ")}`;
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}
function snapshot() {
  return {
    note: "Existing design debt only. Do not refresh to conceal new page-local design rules.",
    styles: Object.fromEntries(walk(source).filter((f) => f.endsWith(".wxss")).map((f) => [normalize(path.relative(source, f)), literals(f)])),
    actions: Object.fromEntries(app.pages.map((route) => [route, actions(route)])),
    catalogHash: crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex")
  };
}
function dependencies(route) {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    visited.add(file);
    const content = read(file);
    const resolve = (ref) => ref.startsWith("/") ? path.join(source, ref.slice(1)) : path.resolve(path.dirname(file), ref);
    for (const match of content.matchAll(/(?:require\s*\(\s*|@import\s+|(?:src|from)=)["']([^"']+)["']/g)) {
      const ref = match[1];
      if (!ref.startsWith(".") && !ref.startsWith("/")) continue;
      const target = resolve(ref);
      if (path.extname(target)) visit(target);
      else [".js", ".json", ".wxss", ".wxml"].forEach((ext) => visit(target + ext));
    }
    if (file.endsWith(".json")) {
      const config = JSON.parse(content);
      Object.values(config.usingComponents || {}).forEach((ref) => {
        if (ref.startsWith("plugin://")) return;
        [".js", ".json", ".wxss", ".wxml"].forEach((ext) => visit(resolve(ref) + ext));
      });
    }
  }
  ["app.js", "app.json", "app.wxss", ...[".js", ".json", ".wxml", ".wxss"].map((ext) => route + ext)].forEach((file) => visit(path.join(source, file)));
  return [...visited].map((file) => normalize(path.relative(root, file)));
}
function check() {
  const errors = [];
  const ids = new Set(catalog.modules.map((module) => module.id));
  const routes = catalog.pages.map((page) => page.route);
  if (new Set(routes).size !== routes.length) errors.push("页面登记重复");
  if (ids.size !== catalog.modules.length) errors.push("模块 ID 重复");
  for (const route of app.pages) if (!routes.includes(route)) errors.push(`页面未登记：${route}`);
  for (const page of catalog.pages) {
    if (!app.pages.includes(page.route)) errors.push(`登记的页面不存在：${page.route}`);
    if (!page.variants.length || !page.roles.length) errors.push(`缺少身份／界面分支：${page.route}`);
    page.modules.forEach((id) => { if (!ids.has(id)) errors.push(`未知模块：${page.route} ${id}`); });
  }
  for (const module of catalog.modules) {
    for (const file of module.logic) if (!fs.existsSync(path.join(source, file))) errors.push(`模块来源不存在：${file}`);
    for (const name of module.components) if (!fs.existsSync(path.join(source, name + ".json"))) errors.push(`组件不存在：${name}`);
  }
  const baselineFile = path.join(system, "baseline.json");
  if (!fs.existsSync(baselineFile)) errors.push("缺少初始设计债务基线");
  else {
    const baseline = JSON.parse(read(baselineFile));
    const current = snapshot();
    for (const [file, declarations] of Object.entries(current.styles)) {
      for (const [key, count] of Object.entries(declarations)) {
        if (count > (baseline.styles[file]?.[key] || 0)) errors.push(`新增局部规则：${file} ${key}；请使用 token／共用样式，或登记有依据的例外`);
      }
    }
    for (const page of catalog.pages) if (JSON.stringify(current.actions[page.route]) !== JSON.stringify(page.actions)) errors.push(`交互入口变化但该页模块目录未复核：${page.route}`);
  }
  const tokens = JSON.parse(read(path.join(system, "tokens.json")));
  for (const file of walk(source).filter((name) => /\.(wxss|wxml|js)$/.test(name))) {
    for (const match of read(file).matchAll(/var\(--am-([\w-]+)/g)) {
      if (!Object.hasOwn(tokens, match[1])) errors.push(`未知设计值：${normalize(path.relative(source, file))} ${match[1]}`);
    }
  }
  const expected = tokenStyles(tokens);
  if (read(path.join(system, "tokens.wxss")).replaceAll("\r\n", "\n") !== expected) errors.push("tokens.wxss 与 tokens.json 不一致；重新生成后再检查");
  if (read(path.join(source, "styles/design-tokens.wxss")).replaceAll("\r\n", "\n") !== expected) errors.push("运行时设计值与唯一来源不一致");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`通过：${routes.length} 页登记完整，${ids.size} 类模块，token 一致，未增加局部样式债务。尚未代表全部模块完成共享迁移。`);
}
function inventory() {
  const snap = snapshot();
  const lines = ["# 全页面功能模块清单（自动生成）", "", "来源：app.json、catalog.json、页面 WXML／JS／WXSS。修改目录后重新运行生成命令。", "", "## 页面与界面分支", "", "| 页面 | 身份 | 界面分支 | 功能模块 |", "|---|---|---|---|"];
  for (const page of catalog.pages) lines.push(`| ${page.name} · ${page.route} | ${page.roles.join("／")} | ${page.variants.join("；")} | ${page.modules.map((id) => catalog.modules.find((m) => m.id === id).name).join("、")} |`);
  lines.push("", "## 模块反查与当前共享程度", "", "shared=已有共享实现；partial=部分共享；local=页面各自实现。语义相同不代表已技术联动。", "");
  for (const module of catalog.modules) {
    lines.push(`### ${module.name}（${module.id}，${module.status}）`, "", `- 使用页：${catalog.pages.filter((page) => page.modules.includes(module.id)).map((page) => page.name).join("、")}`, `- 共享组件：${module.components.join("、") || "无，待抽取"}`, `- 现有逻辑／样式来源：${module.logic.join("、") || "各页面本地实现"}`, "");
  }
  lines.push("## 页面交互入口（源码提取）", "");
  for (const page of catalog.pages) lines.push(`- **${page.name}**：${snap.actions[page.route].join("、") || "无绑定交互"}`);
  const values = (property) => [...new Set(Object.values(snap.styles).flatMap((entries) => Object.keys(entries).filter((key) => key.startsWith(property + ":"))))].sort();
  lines.push("", "## 现有样式债务", "", `扫描 ${Object.keys(snap.styles).length} 份 WXSS；以下是当前源码字面量，不是推荐规范。`, "");
  for (const property of ["font-size", "font-weight", "line-height", "gap", "border-radius"]) lines.push(`- ${property}：${values(property).length} 种；${values(property).map((value) => value.split(": ").slice(1).join(": ")).join("、")}`);
  fs.writeFileSync(path.join(system, "INVENTORY.md"), lines.join("\n") + "\n");
  console.log(`已生成 ${catalog.pages.length} 页、${catalog.modules.length} 类模块的双向清单。`);
}
function impact(input) {
  if (!input) throw new Error("请提供模块 ID 或修改的文件路径");
  const module = catalog.modules.find((entry) => entry.id === input);
  const file = normalize(input).replace(/^wechat-miniprogram\//, "");
  const globalRule = file.startsWith("design-system/") || file === "miniprogram/app.wxss";
  const direct = catalog.pages.filter((page) => dependencies(page.route).includes(file));
  const owner = catalog.pages.find((page) => file.startsWith("miniprogram/" + page.route + "."));
  const moduleIds = module ? [module.id] : owner ? owner.modules.filter((id) => !["navigation", "page-state", "actions"].includes(id)) : catalog.modules.filter((m) => [...m.logic, ...m.components.flatMap((c) => [".js", ".json", ".wxss", ".wxml"].map((ext) => c + ext))].some((ref) => file === "miniprogram/" + ref)).map((m) => m.id);
  const related = catalog.pages.filter((page) => globalRule || page.modules.some((id) => moduleIds.includes(id)));
  if (!module && !globalRule && !direct.length && !related.length) throw new Error("未识别影响范围；不得按零影响放行，请补全目录或文件路径");
  console.log(JSON.stringify({ change: input, modules: moduleIds, automaticallyDependent: direct.map((p) => p.route), requiresSemanticReview: related.map((p) => ({ route: p.route, variants: p.variants })), note: "直接依赖≠已验证；语义关联中仍有页面本地副本，须逐页迁移或验证。动态引用／原型文件需要人工补查。" }, null, 2));
}
if (require.main === module) {
  try {
    const command = process.argv[2] || "check";
    if (command === "inventory") inventory();
    else if (command === "impact") impact(process.argv[3]);
    else if (command === "tokens") {
      const tokens = JSON.parse(read(path.join(system, "tokens.json")));
      fs.writeFileSync(path.join(system, "tokens.wxss"), tokenStyles(tokens));
      fs.writeFileSync(path.join(source, "styles/design-tokens.wxss"), tokenStyles(tokens));
      console.log("已从唯一 token 源生成 WXSS。");
      require('./build-design-theme')();
    }
    else if (command === "baseline") {
      const file = path.join(system, "baseline.json");
      if (fs.existsSync(file)) throw new Error("基线已经存在；禁止无审查整体刷新，需逐项解释并调整已批准的例外。");
      fs.writeFileSync(file, JSON.stringify(snapshot(), null, 2) + "\n");
      console.log("已登记初始存量债务；后续检查不允许新增局部规则。");
    } else if (command === "check") check();
    else throw new Error(`未知命令：${command}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { actions, literals, dependencies, snapshot };
