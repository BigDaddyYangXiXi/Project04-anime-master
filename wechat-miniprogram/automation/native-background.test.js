const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
test('所有路由在样式加载前拥有与主题一致的原生容器背景', () => {
  const color = read('design-system/tokens.json')['color-canvas'];
  const app = read('miniprogram/app.json');
  for (const key of ['backgroundColor', 'backgroundColorContent', 'backgroundColorTop', 'backgroundColorBottom']) assert.equal(app.window[key], color, key);
  for (const route of app.pages) assert.equal(read('miniprogram/' + route + '.json').backgroundColorContent, color, route);
});
