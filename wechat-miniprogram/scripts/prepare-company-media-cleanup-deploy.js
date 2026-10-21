// Prepare an authenticated manual-only service. Never inherit the legacy timer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const envId = 'cloudbase-d2g65rqbvee0bd978';
const base = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));
if (base.envId !== envId) throw Error('COMPANY_ENVIRONMENT_MISMATCH');
const file = path.join(root, '.cloudbase-cli-config/company-media-cleanup-deploy.json');
let token;
if (fs.existsSync(file)) {
  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (previous.envId !== envId || previous.functions?.length !== 1
    || previous.functions[0].name !== 'media-pending-cleanup') throw Error('CLEANUP_CONFIG_MISMATCH');
  token = previous.functions[0].envVariables?.MEDIA_CLEANUP_TOKEN;
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Error('CLEANUP_TOKEN_INVALID');
} else token = crypto.randomBytes(32).toString('hex');
const config = { envId, functionRoot: 'cloudfunctions', functions: [{
  name: 'media-pending-cleanup', runtime: 'Nodejs20.19', handler: 'index.main',
  timeout: 60, memorySize: 256, triggers: [],
  envVariables: { MEDIA_CLEANUP_TOKEN: token }
}] };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ prepared: true, function: 'media-pending-cleanup', scheduled: false, deployed: false }));
