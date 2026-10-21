const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server-shared/account-names.js'));
for (const name of ['account-bootstrap', 'account-api']) {
  const target = path.join(root, 'cloudfunctions', name, 'account-names.js');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) throw Error(`ACCOUNT_NAMES_COPY_MISMATCH:${name}`);
  } else fs.writeFileSync(target, source);
}
