const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pagesRoot = path.resolve(__dirname, "../miniprogram/pages");
const visiblePageId = /(?:^|[>\s])(?:B|S|M)\d{2}\s*·/;
const files = fs.readdirSync(pagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(pagesRoot, entry.name, "index.wxml"))
  .filter((file) => fs.existsSync(file));
const offenders = files.filter((file) => visiblePageId.test(fs.readFileSync(file, "utf8")));
const pageDescriptionOffenders = files.filter((file) => /class="(?:eyebrow|detail-eyebrow)"/.test(fs.readFileSync(file, "utf8")));
const styleOffenders = files
  .map((file) => file.replace(/\.wxml$/, ".wxss"))
  .filter((file) => fs.existsSync(file) && /\.(?:detail-)?eyebrow\s*\{/.test(fs.readFileSync(file, "utf8")));

assert.deepStrictEqual(offenders, [], `生产页面不得显示内部页面编号：${offenders.join(", ")}`);
assert.deepStrictEqual(pageDescriptionOffenders, [], `生产页面不得显示开发期页面描述：${pageDescriptionOffenders.join(", ")}`);
assert.deepStrictEqual(styleOffenders, [], `生产样式不得遗留开发期页面描述选择器：${styleOffenders.join(", ")}`);
process.stdout.write(`Visible page ID and development-description audit: ${files.length} page templates passed\n`);
