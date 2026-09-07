// Source-based web layout checks only; native authorization requires WeChat evidence.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(__dirname, "../.artifacts/auth-responsive-preview");
const template = fs.readFileSync(path.join(root, "pages/auth/index.wxml"), "utf8");
const styles = ["app.wxss", "pages/auth/index.wxss"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
let definition;
global.wx = {};
global.Page = value => { definition = value; };
require("../miniprogram/pages/auth/index");

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  try {
    for (const width of [320, 375, 414]) {
      const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: 1 });
      for (const state of ["login", "register", "error"]) {
        for (const fontScale of [1, 1.2]) {
          const auth = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
          auth.setData = patch => Object.assign(auth.data, patch);
          auth.onLoad({ audit: "1", state });
          const css = styles.replace(/(-?[\d.]+)rpx/g, (_, value) => `${Number(value) * width / 750}px`)
            .replace(/font-size:\s*([\d.]+)px/g, (_, value) => `font-size: ${Number(value) * fontScale}px`)
            .replace(/\bpage\b/g, "body").replace(/\bview\b/g, "div");
          await page.setContent(`<style>body{margin:0}button,input{font-family:inherit;border:0}button{cursor:pointer}button[disabled]{opacity:.5}input{box-sizing:border-box}</style><style>${css}</style><main></main>`);
          await page.evaluate(({ template, data }) => {
            const doc = new DOMParser().parseFromString(template, "text/html");
            const evaluate = expression => Function("data", `with(data){return (${expression})}`)(data);
            const interpolate = value => value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression)));
            function render(parent, target) {
              let matched = false;
              for (const node of parent.childNodes) {
                if (node.nodeType === 3) { target.append(document.createTextNode(interpolate(node.textContent))); continue; }
                if (node.nodeType !== 1) continue;
                const condition = node.getAttribute("wx:if"), otherwise = node.getAttribute("wx:elif");
                if (condition !== null) { matched = evaluate(condition.slice(2, -2)); if (!matched) continue; }
                else if (otherwise !== null) { if (matched) continue; matched = evaluate(otherwise.slice(2, -2)); if (!matched) continue; }
                else if (node.hasAttribute("wx:else")) { if (matched) continue; matched = true; }
                else matched = false;
                if (node.tagName === "APP-TOP-NAV") { const nav = document.createElement("div"); nav.style.height = "88px"; nav.style.background = "white"; target.append(nav); continue; }
                const tag = { VIEW: "div", TEXT: "span", IMAGE: "img" }[node.tagName] || node.tagName.toLowerCase();
                const element = document.createElement(tag);
                for (const attribute of node.attributes) {
                  if (/^(wx:|bind)/.test(attribute.name)) continue;
                  const value = interpolate(attribute.value);
                  if (attribute.name === "disabled" && value === "false") continue;
                  element.setAttribute(attribute.name, value);
                }
                render(node, element);
                target.append(element);
              }
            }
            render(doc.body, document.querySelector("main"));
          }, { template: template.replace(/<(app-top-nav|image|input)\b([^>]*?)\/>/g, "<$1$2></$1>"), data: auth.data });
          const brand = fs.readFileSync(path.join(root, "assets/brand/peach-slime-main-768.jpg")).toString("base64");
          await page.locator("img").evaluate((img, brand) => { img.src = `data:image/jpeg;base64,${brand}`; }, brand);
          await page.locator("img").evaluate(img => img.decode());
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          assert.equal(overflow, false, `${state} ${width}px ${fontScale}x horizontal overflow`);
          const button = await page.locator(".primary-button").boundingBox();
          const content = await page.locator(".auth-form").boundingBox();
          assert.ok(Math.abs(button.width - content.width) < 1, "primary action spans form");
          await page.screenshot({ path: path.join(output, `${state}-${width}-${fontScale}.png`), fullPage: true });
          results.push({ state, width, fontScale, overflow });
        }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ evidence: "WXML/WXSS web projection, not native authorization", results }, null, 2));
  console.log(`Auth source-based responsive checks passed: ${results.length}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
