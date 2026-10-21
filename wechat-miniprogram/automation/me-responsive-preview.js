// Isolated WXML web projection. Never connects to the running WeChat client.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('../../.artifacts/vi-tooling/node_modules/playwright');
const root = path.resolve(__dirname, '../miniprogram');
const funds = process.argv.includes('--funds');
const output = path.resolve(__dirname, funds ? '../.artifacts/funds-buyer-20261007' : '../.artifacts/me-redesign-20261007');
const template = fs.readFileSync(path.join(root, funds ? 'pages/funds/index.wxml' : 'pages/me/index.wxml'), 'utf8').replace(/<(app-top-nav|image)\b([^>]*?)\/>/g, '<$1$2></$1>');
const styles = ['styles/design-tokens.wxss', 'styles/actions.wxss', 'styles/money.wxss', 'app.wxss', funds ? 'pages/funds/index.wxss' : 'pages/me/index.wxss'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n').replace(/@import[^;]+;/g, '').replace(/(^|[{}])([^{}]+)\{/g, (_, boundary, selector) => boundary + selector.replace(/(?<![\w-])text(?![\w-])/g, 'span').replace(/(?<![\w-])image(?![\w-])/g, 'img') + '{');
const stats = labels => labels.map(label => ({ label, value: 0 }));
function fixture(role, state) {
  if (funds) return { role, records: state === "long" ? [{ id:"order1", orderId:"ORDER-TEST-1", title:"角色妆造与造型合作", statusText:"付款已确认", amountText:"￥123.45", feeText:"￥24.69", incomeText:"￥98.76", incomeStateText:"待结算", timeText:"2026-10-07 15:00" }] : [], loading:state === "loading", loaded:state !== "loading" && state !== "error", loadError:state === "error" ? "暂时无法读取订单款项，请重试。" : "", nextCursor:null, moreError:"", merchantCopy:"尚未提交收款资料", taxCopy:"", taxError:false, settlementCopy:"结算功能尚未开放" };
  return { role, account: { nickname: state === 'long' ? '这是一个十二字符的测试昵称' : '站长', avatar: '', username: 'Kehaar' }, initial: '站',
    buyerHighlights: ["喜欢", "关注", "合作"].map((label, i) => ({ key: ["liked", "followed", "orders"][i], label, value: state === "loading" || state === "error" ? "—" : 0 })),
    providerHighlights: ['获赞','粉丝','合作'].map((label,i)=>({key:['likes','followers','coops'][i],label,value:state==='loading'||state==='error'?'—':0})), projectText:'整理角色与合作需求', recentProject:null, projectReady:state==='zero', todoText:'暂无需要处理的订单', buyerStats: state === 'loading' || state === 'error' ? [] : stats(['历史合作', '进行中订单', '参考作品']),
    providerStats: state === 'loading' || state === 'error' ? [] : stats(['历史合作', '作品创作', '作品被参考', '作品被收藏', '账号获关注']),
    assets: ['followed', 'liked', 'referenced'].map((key, i) => ({ key, label: ['我的关注', '我的喜欢', '参考作品'][i], value: state === 'error' || state === 'loading' ? '—' : 0 })),
    storefrontStatusText: '橱窗未发布', previewMeta: '橱窗尚未发布', dashboardLoading: state === 'loading', dashboardError: state === 'error' ? '个人中心暂时未能加载，请重试。' : '', previewOnly: false };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = [];
  try {
    for (const width of [320, 375, 414]) for (const role of ['buyer', 'provider']) for (const state of ['zero', 'long', 'loading', 'error']) {
      const fontScale = state === 'long' ? 1.2 : 1;
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      const css = styles.replace(/(-?[\d.]+)rpx/g, (_, n) => `${Number(n) * width / 750}px`).replace(/(--am-type-[\w-]+:\s*)([\d.]+)px/g, (_, prefix, n) => `${prefix}${Number(n) * fontScale}px`).replace(/\bpage\b/g, 'body').replace(/\bview\b/g, 'div');
      await page.setContent(`<style>body{margin:0}button{font-family:inherit;border:0;cursor:pointer}img{object-fit:contain}span{box-sizing:border-box}</style><style>${css}</style><main></main>`);
      await page.evaluate(({ template, data }) => {
        const doc = new DOMParser().parseFromString(template, 'text/html');
        const evaluate = (expr, scope) => Function('scope', `with(scope){return (${expr})}`)(scope);
        const interpolate = (str, scope) => str.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => String(evaluate(expr, scope) ?? ''));
        function render(parent, target, scope) {
          let matched = false;
          for (const node of parent.childNodes) {
            if (node.nodeType === 3) { target.append(document.createTextNode(interpolate(node.textContent, scope))); continue; }
            if (node.nodeType !== 1) continue;
            const condition = node.getAttribute('wx:if'), otherwise = node.getAttribute('wx:elif');
            if (condition !== null) { matched = evaluate(condition.slice(2, -2), scope); if (!matched) continue; }
            else if (otherwise !== null) { if (matched) continue; matched = evaluate(otherwise.slice(2, -2), scope); if (!matched) continue; }
            else if (node.hasAttribute('wx:else')) { if (matched) continue; matched = true; }
            else matched = false;
            const loop = node.getAttribute('wx:for');
            const items = loop ? evaluate(loop.slice(2, -2), scope) : [null];
            for (const [index, item] of items.entries()) {
              const local = loop ? { ...scope, item, index } : scope;
              if (node.tagName === 'APP-TOP-NAV') { const nav = document.createElement('div'); nav.style.cssText = 'height:88px;box-sizing:border-box;padding:48px 16px 12px;background:var(--am-color-surface);display:flex;justify-content:space-between;'; nav.innerHTML = `<span>${data.role === 'buyer' ? '需求方' : '服务方'} ⇄</span><strong>${node.getAttribute("title") || "我的"}</strong><span>•••</span>`; target.append(nav); continue; }
              if (node.tagName === 'BLOCK') { render(node, target, local); continue; }
              const element = document.createElement(({ VIEW: 'div', TEXT: 'span', IMAGE: 'img' })[node.tagName] || node.tagName.toLowerCase());
              for (const attribute of node.attributes) {
                if (/^(wx:|bind)/.test(attribute.name)) continue;
                element.setAttribute(attribute.name, interpolate(attribute.value, local));
              }
              render(node, element, local); target.append(element);
            }
          }
        }
        render(doc.body, document.querySelector('main'), data);
      }, { template, data: fixture(role, state) });
      for (const img of await page.locator('img').all()) {
        const src = await img.getAttribute('src');
        const file = path.join(root, src);
        assert.ok(fs.existsSync(file), `missing icon ${src}`);
        await img.evaluate((el, url) => { el.src = url; }, 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64'));
      }
      const measurements = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        return { overflow: document.documentElement.scrollWidth > innerWidth, tooSmall: buttons.filter(el => el.getBoundingClientRect().height < 43.9).map(el => el.className), panelPadding: getComputedStyle(document.querySelector('.me-panel, .funds-shell')).paddingLeft, panelGap: getComputedStyle(document.querySelector('.me-panel, .funds-shell')).marginBottom, panelBorder: getComputedStyle(document.querySelector('.me-panel, .funds-shell')).borderWidth };
      });
      assert.equal(measurements.overflow, false, `${role}/${state}/${width} overflow`);
      assert.deepEqual(measurements.tooSmall, [], `${role}/${state}/${width} small touch targets`);
      if (funds && state === 'long') {
        assert.equal(await page.locator('.record-main > span').first().evaluate(el => getComputedStyle(el).display), 'block', 'record text selectors must survive projection');
      }
      if (!funds) assert.equal(await page.locator('.collection-entry').count(), 3);
      if (!funds) assert.equal(await page.locator('.main-action').count(), 0);
      if (!funds) assert.equal(await page.locator('.buyer-tool').count(), 4);
      await page.screenshot({ path: path.join(output, `${role}-${state}-${width}.png`), fullPage: true });
      results.push({ role, state, width, fontScale, ...measurements });
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ evidence: 'Web projection, not native WeChat acceptance', results }, null, 2));
  console.log(`Personal-center layout projections passed: ${results.length}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
