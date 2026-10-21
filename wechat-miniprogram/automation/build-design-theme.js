const fs = require('node:fs');
const path = require('node:path');
function buildTheme() {
  require('./build-me-icons')();
  const root = path.resolve(__dirname, '..');
  const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design-system/tokens.json'), 'utf8'));
  // Set the native page container before WXSS loads; window background alone does not cover it.
  const appFile = path.join(root, 'miniprogram/app.json');
  const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
  for (const key of ['backgroundColor', 'backgroundColorContent', 'backgroundColorTop', 'backgroundColorBottom']) app.window[key] = tokens['color-canvas'];
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n');
  for (const route of app.pages) {
    const file = path.join(root, 'miniprogram', route + '.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.backgroundColorContent = tokens['color-canvas'];
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(root, 'design-system/TOKEN-REFERENCE.md'), '# 当前设计值（自动生成）\n\n唯一来源 tokens.json，禁止手动维护另一套数值表。\n\n| 名称 | 当前值 |\n| --- | --- |\n' + Object.entries(tokens).map(([key, value]) => `| ${key} | ${value} |`).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'miniprogram/data/design-theme.js'), '// Generated from design-system/tokens.json.\nmodule.exports = ' + JSON.stringify({ brandColor: tokens['color-brand'], nativeBrandColor: tokens['color-native-brand'], controlColor: tokens['color-control-surface'] }, null, 2) + ';\n');
  for (const name of ['clock', 'check', 'message', 'document', 'lock']) {
    const file = path.join(root, 'miniprogram/assets/booking', 'status-' + name + '.svg');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/#[0-9a-f]{6}/gi, tokens['color-brand']));
  }
  for (const name of ['browse-location', 'browse-date', 'browse-chevron', 'browse-search', 'work-like', 'work-like-active']) {
    const file = path.join(root, 'miniprogram/assets/actions', name + '.svg');
    const color = name === 'work-like-active' ? tokens['color-brand'] : tokens['browse-control-ink'];
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/#[0-9a-f]{6}/gi, color));
  }
}
if (require.main === module) buildTheme();
module.exports = buildTheme;
