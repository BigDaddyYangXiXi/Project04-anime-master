const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../miniprogram');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tokens = require('../design-system/tokens.json');
test('列表价格跨首页和双身份订单复用同一个金额角色', () => {
  for (const file of ['components/work-card/index', 'pages/orders/index', 'pages/provider-orders/index']) {
    assert.match(read(file + '.wxml'), /am-money am-money-list/);
    assert.match(read(file + '.wxss'), /styles\/money\.wxss/);
  }
  assert.match(read('styles/money.wxss'), /font-variant-numeric: tabular-nums/);
});
test('原生窗口和喜欢资源与主题同源，不残留旧蓝色主色', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.window.backgroundColor, tokens['color-canvas']);
  assert.equal(app.window.navigationBarBackgroundColor, tokens['color-canvas']);
  assert.equal(require('../miniprogram/data/design-theme').brandColor, tokens['color-brand']);
  assert.ok(read('assets/actions/work-like-active.svg').includes(tokens['color-brand']));
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(wxss|wxml|js|json|svg)$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /#(?:08b8eb|36c9f2|123345|06202c)/i, file);
    }
  }
  walk(root);
});
