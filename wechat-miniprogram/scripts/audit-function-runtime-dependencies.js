// Run before deploying with --install-dependency false. Never reads deployment secrets.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const root = args[0] === '--root' ? path.resolve(args[1]) : path.resolve(__dirname, '../cloudfunctions');
const names = args[0] === '--root' ? args.slice(2) : args;
if (!names.length) throw Error('FUNCTION_NAMES_REQUIRED');
for (const name of names) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error('INVALID_FUNCTION_NAME');
  const directory = path.join(root, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  const issues = require('./local-module-audit').inspectLocalModules(directory);
  for (const [dependency, version] of Object.entries(manifest.dependencies || {})) {
    if (lock.packages?.['']?.dependencies?.[dependency] !== version) issues.push(`${dependency}: lock mismatch`);
    const installed = path.join(directory, 'node_modules', dependency, 'package.json');
    if (!fs.existsSync(installed)) issues.push(`${dependency}: local runtime package missing`);
  }
  // npm validates the full installed tree, including transitive dependencies and overrides.
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const check = spawnSync(process.execPath, [npmCli, 'ls', '--omit=dev', '--all', '--json'], {
    cwd: directory, encoding: 'utf8', timeout: 30000
  });
  if (check.status !== 0) issues.push('installed dependency tree invalid or unavailable');
  console.log(JSON.stringify({ function: name, ok: issues.length === 0, issues }));
  if (issues.length) process.exitCode = 1;
}
