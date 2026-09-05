const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "miniprogram");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const wxmlFiles = [];
function collect(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith(".wxml")) wxmlFiles.push(target);
  });
}
collect(root);

const allWxml = wxmlFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert(!/[✓✔☑○●⌄⌃⌕]/.test(allWxml), "生产 WXML 不得使用字体字符冒充结构性图标");

const discoverWxml = read("pages", "discover", "index.wxml");
const discoverWxss = read("pages", "discover", "index.wxss");
const resultsWxml = read("pages", "search-results", "index.wxml");
const detailWxml = read("pages", "provider-detail", "index.wxml");
const detailWxss = read("pages", "provider-detail", "index.wxss");
const requestWxml = read("pages", "provider-request", "index.wxml");
const requestWxss = read("pages", "provider-request", "index.wxss");

assert(discoverWxml.includes('<view class="search-icon" aria-hidden="true"></view>'));
assert(resultsWxml.includes('<view class="search-icon" aria-hidden="true"></view>'));
assert(discoverWxml.includes('class="check-mark"'));
assert(discoverWxss.includes(".check-mark"));
assert(detailWxml.includes('class="service-check-mark {{item.selected'));
assert(detailWxml.includes('class="service-chevron {{item.expanded ? \'expanded\' : \'\'}}"'));
assert(detailWxss.includes(".service-chevron.expanded"));
assert(requestWxml.includes('class="confirmation-state') && requestWxml.includes('class="confirm-mark"'));
assert(requestWxss.includes(".confirm-mark"));

process.stdout.write("Icon implementation audit: 10 assertions passed\n");
