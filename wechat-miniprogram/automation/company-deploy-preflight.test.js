const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preflight } = require('../scripts/company-deploy-preflight');

function fixture(t) {
  const base = path.resolve(__dirname, '../.artifacts');
  fs.mkdirSync(base, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(base, 'deploy-preflight-test-'));
  t.after(() => { if (path.dirname(cwd) !== base) throw Error('UNSAFE_CLEANUP'); fs.rmSync(cwd, { recursive: true, force: true }); });
  const config = { envId: 'cloudbase-d2g65rqbvee0bd978', functionRoot: 'staging', functions: [{ name: 'example' }] };
  const save = () => fs.writeFileSync(path.join(cwd, 'custom.json'), JSON.stringify(config));
  save();
  fs.mkdirSync(path.join(cwd, 'staging/example'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'staging/example/index.js'), 'exports.main=()=>({});');
  const args = ['--config-file', 'custom.json', 'fn', 'deploy', 'example', '--install-dependency', 'false', '--force', '--json'];
  return { cwd, config, save, args };
}

test('read-only CLI commands do not require deployment configuration', () => {
  assert.doesNotThrow(() => preflight(['db', 'execute', '--read-only']));
  assert.doesNotThrow(() => preflight(['fn', 'invoke', 'example']));
});

test('code-only updates require an explicit package and disable automatic dependency installation', t => {
  const f = fixture(t), dir = path.join(f.cwd, 'staging/example');
  const manifest = { name: 'example', version: '1.0.0', dependencies: {} };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({lockfileVersion:3,packages:{'':manifest}}));
  const args = ['fn', 'code', 'update', 'example', '--dir', dir, '--config-file', 'custom.json'];
  assert.throws(() => preflight(args, f.cwd), /LOCKED_DEPENDENCIES/);
  f.config.functions[0].installDependency = true; f.save();
  assert.throws(() => preflight(args, f.cwd), /LOCKED_DEPENDENCIES/);
  f.config.functions[0].installDependency = false; f.save();
  assert.doesNotThrow(() => preflight(args, f.cwd));
  assert.throws(() => preflight(args.slice(0,6), f.cwd), /EXPLICIT_PACKAGE/);
  assert.throws(() => preflight(args.map(a => a === dir ? f.cwd : a), f.cwd), /LOCKED_DEPENDENCIES/);
  assert.throws(() => preflight([...args, '--env-id', 'other'], f.cwd), /EXPLICIT_PACKAGE/);
});

test('missing or stale shared identity rules block deployment even with online installation', t => {
  const f = fixture(t);
  const dir = path.join(f.cwd, 'staging/example');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), "require('./request-context');");
  for (const mode of ['true', 'false']) {
    const args = f.args.map(value => value === 'false' ? mode : value);
    assert.throws(() => preflight(args, f.cwd), /REQUEST_CONTEXT_MISMATCH/);
    fs.writeFileSync(path.join(dir, 'request-context.js'), 'module.exports = () => process.env;');
    assert.throws(() => preflight(args, f.cwd), /REQUEST_CONTEXT_MISMATCH/);
    fs.unlinkSync(path.join(dir, 'request-context.js'));
  }
  fs.copyFileSync(path.join(__dirname, '../server-shared/request-context.js'), path.join(dir, 'request-context.js'));
  assert.doesNotThrow(() => preflight(f.args.map(value => value === 'false' ? 'true' : value), f.cwd));
});
test('old staged company entry cannot skip identity checks by omitting the helper import', t => {
  const f = fixture(t);
  f.config.functions = [{ name: 'payment-api' }]; f.save();
  const dir = path.join(f.cwd, 'staging/payment-api');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../server-shared/request-context.js'), path.join(dir, 'request-context.js'));
  for (const mode of ['true', 'false']) {
    const args = f.args.map(value => value === 'example' ? 'payment-api' : value === 'false' ? mode : value);
    assert.throws(() => preflight(args, f.cwd), /REQUEST_CONTEXT_ENTRY_MISMATCH/);
    fs.writeFileSync(path.join(dir, 'index.js'), 'exports.main = () => process.env;');
    assert.throws(() => preflight(args, f.cwd), /REQUEST_CONTEXT_ENTRY_MISMATCH/);
    fs.unlinkSync(path.join(dir, 'index.js'));
  }
  const source = path.join(__dirname, '../cloudfunctions/payment-api');
  for (const file of fs.readdirSync(source).filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !name.startsWith('test-'))) {
    fs.copyFileSync(path.join(source, file), path.join(dir, file));
  }
  assert.doesNotThrow(() => preflight(f.args.map(value => value === 'example' ? 'payment-api' : value === 'false' ? 'true' : value), f.cwd));
});

test('wrong environment and missing function are rejected before uploading', t => {
  const f = fixture(t);
  f.config.envId = 'wrong'; f.save();
  assert.throws(() => preflight(f.args, f.cwd), /CONFIG_MISMATCH/);
  f.config.envId = 'cloudbase-d2g65rqbvee0bd978'; f.config.functions = []; f.save();
  assert.throws(() => preflight(f.args, f.cwd), /CONFIG_MISMATCH/);
});
test('missing runtime packages stop an offline deployment from its actual staging root', t => {
  const f = fixture(t);
  const dir = path.join(f.cwd, 'staging/example');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', dependencies: { missing: '1.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { missing: '1.0.0' } } } }));
  assert.throws(() => preflight(f.args, f.cwd), /RUNTIME_DEPENDENCIES_INVALID/);
});
test('valid staged package passes local checks without invoking CloudBase', t => {
  const f = fixture(t);
  const dir = path.join(f.cwd, 'staging/example');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { name: 'example', version: '1.0.0', dependencies: {} };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'example', version: '1.0.0', lockfileVersion: 3, packages: { '': manifest } }));
  assert.doesNotThrow(() => preflight(f.args, f.cwd));
});
test('online dependency installation still checks company and function selection', t => {
  const f = fixture(t); f.args[f.args.indexOf('false')] = 'true';
  assert.doesNotThrow(() => preflight(f.args, f.cwd));
  f.config.envId = 'other'; f.save();
  assert.throws(() => preflight(f.args, f.cwd), /CONFIG_MISMATCH/);
});

test('online installation cannot repair a missing deferred local business module', t => {
  const f = fixture(t), dir = path.join(f.cwd, 'staging/example');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), "exports.main=()=>require('./fund-audit');");
  fs.writeFileSync(path.join(dir, 'fund-audit.js'), "require('./finance-result-fingerprint');");
  const args = f.args.map(value => value === 'false' ? 'true' : value);
  assert.throws(() => preflight(args, f.cwd), /LOCAL_MODULES_INVALID/);
  fs.writeFileSync(path.join(dir, 'finance-result-fingerprint.js'), 'module.exports={};');
  assert.doesNotThrow(() => preflight(args, f.cwd));
  fs.unlinkSync(path.join(dir, 'index.js'));
  assert.throws(() => preflight(args, f.cwd), /LOCAL_MODULES_INVALID/);
});
test('ambiguous options and unsupported source/environment overrides fail closed', t => {
  const f = fixture(t);
  for (const tail of [['--all'], ['--dir', '.'], ['--env-id=other'], ['--config-file=custom.json'], ['--install-dependency=true']]) {
    assert.throws(() => preflight([...f.args, ...tail], f.cwd));
  }
  const equals = ['--config-file=custom.json', 'fn', 'deploy', 'example', '--install-dependency=true'];
  assert.doesNotThrow(() => preflight(equals, f.cwd));
});
