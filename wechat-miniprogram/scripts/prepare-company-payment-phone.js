// Isolated online preview. Never copies cloud-function code or private deployment material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const name = process.argv[2] || 'company-payment-refund-phone-20260925';
if (!/^company-payment-refund-phone-[a-z0-9-]+$/.test(name)) throw Error('PREVIEW_NAME_INVALID');
const destination = path.join(root, '.artifacts', name);
if (fs.existsSync(destination)) throw Error('PREVIEW_ALREADY_EXISTS');
const project = require('../project.config.json');
const cloud = require('../cloudbaserc.json');
if (project.appid !== 'wxc94e1c1b38944511' || cloud.envId !== 'cloudbase-d2g65rqbvee0bd978') throw Error('PREVIEW_TARGET_MISMATCH');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(root, 'miniprogram'), path.join(destination, 'miniprogram'), { recursive: true });
fs.writeFileSync(path.join(destination, 'project.config.json'), JSON.stringify(project, null, 2));
// Company identity verified on 2026-09-30; 3.17.3 returned an empty runtime AppID.
fs.writeFileSync(path.join(destination, 'project.private.config.json'), JSON.stringify({
  setting: { useApiHook: false, urlCheck: true }, libVersion: '3.17.0'
}, null, 2));
fs.writeFileSync(path.join(destination, 'cloudbaserc.json'), JSON.stringify({ envId: cloud.envId }));
const configFile = path.join(destination, 'miniprogram/config/cloudbase.js');
const original = fs.readFileSync(configFile, 'utf8');
if ((original.match(/enabled: false/g) || []).length !== 1) throw Error('PREVIEW_CLIENT_CONFIG_CHANGED');
fs.writeFileSync(configFile, original.replace('enabled: false', 'enabled: true'));
const blockers = require('./check-release-config').inspect({ project, cloud,
  client: require(configFile) });
if (blockers.length) throw Error('PREVIEW_CONFIG_INVALID');
const files = [];
function scan(relative) {
  for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) scan(name);
    else {
      const source = fs.readFileSync(path.join(root, name));
      const copy = fs.readFileSync(path.join(destination, name));
      const changed = !source.equals(copy);
      if (changed && name.replaceAll('\\', '/') !== 'miniprogram/config/cloudbase.js') throw Error('UNEXPECTED_PREVIEW_CHANGE');
      files.push({ path: name.replaceAll('\\', '/'), sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
        previewSha256: crypto.createHash('sha256').update(copy).digest('hex'), cloudSwitchOnly: changed });
    }
  }
}
scan('miniprogram');
fs.writeFileSync(path.join(destination, 'source-manifest.json'), JSON.stringify({ preparedAt: new Date().toISOString(),
  appid: project.appid, env: cloud.envId, files, runtimeAccepted: false, uploaded: false }, null, 2));
console.log(JSON.stringify({ prepared: true, files: files.length, cloudEnabled: true, uploaded: false }));
