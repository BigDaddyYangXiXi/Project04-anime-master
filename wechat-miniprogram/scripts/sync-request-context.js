const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const consumers = ['account-api', 'account-bootstrap', 'auth-probe', 'availability-api',
  'media-pending-cleanup', 'media-security-submit', 'media-upload', 'order-api', 'payment-api',
  'project-api', 'provider-catalog-draft', 'saved-items-api', 'support-api'];
const source = fs.readFileSync(path.join(root, 'server-shared/request-context.js'));
for (const name of consumers) {
  const target = path.join(root, 'cloudfunctions', name, 'request-context.js');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) throw Error(`REQUEST_CONTEXT_COPY_MISMATCH:${name}`);
  } else fs.writeFileSync(target, source);
}
console.log(`Request-context copies ${process.argv.includes('--check') ? 'verified' : 'updated'}: ${consumers.length}`);
