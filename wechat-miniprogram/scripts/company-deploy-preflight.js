const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Only the company's explicit single-function deployment workflow is supported here.
// Read configuration locally; never print environment variables or CLI output containing them.
function preflight(args, cwd = process.cwd()) {
  const codeUpdate = args.findIndex((value, index) => ['fn', 'functions'].includes(value) && args[index + 1] === 'code' && args[index + 2] === 'update');
  if (codeUpdate >= 0 && !args.includes('--help') && !args.includes('-h')) {
    const values = flag => args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : arg.startsWith(flag + '=') ? [arg.slice(flag.length + 1)] : []);
    const configs = values('--config-file'), dirs = values('--dir'), name = args[codeUpdate + 3];
    if (configs.length !== 1 || dirs.length !== 1 || args.some(arg => /^(--env-id|-e|--envId)(=|$)/.test(arg))) throw Error('CODE_UPDATE_REQUIRES_EXPLICIT_PACKAGE');
    const config = JSON.parse(fs.readFileSync(path.resolve(cwd, configs[0]), 'utf8'));
    const matches = (config.functions || []).filter(fn => fn.name === name);
    if (config.envId !== 'cloudbase-d2g65rqbvee0bd978' || matches.length !== 1 || matches[0].installDependency !== false
      || path.resolve(cwd, dirs[0]) !== path.resolve(cwd, config.functionRoot || 'functions', name)) throw Error('CODE_UPDATE_REQUIRES_LOCKED_DEPENDENCIES');
    preflight(['fn', 'deploy', name, '--config-file', configs[0], '--install-dependency', 'false'], cwd);
    return;
  }
  const command = args.findIndex((value, index) => ['fn', 'functions'].includes(value) && args[index + 1] === 'deploy');
  if (command < 0 || args.includes('--help') || args.includes('-h')) return;
  const name = args[command + 2];
  if (!/^[a-z][a-z0-9-]*$/.test(name || '') || args.some(value => /^(--all|--dir|-d|--env-id|-e)(=|$)/.test(value))) {
    throw Error('COMPANY_DEPLOY_REQUIRES_EXPLICIT_CONFIG_AND_FUNCTION');
  }
  const values = flag => args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : arg.startsWith(flag + '=') ? [arg.slice(flag.length + 1)] : []);
  const configs = values('--config-file');
  const installs = values('--install-dependency');
  if (configs.length > 1 || installs.length !== 1 || !['true', 'false'].includes(installs[0])) throw Error('COMPANY_DEPLOY_OPTIONS_INVALID');
  let config;
  try { config = JSON.parse(fs.readFileSync(path.resolve(cwd, configs[0] || 'cloudbaserc.json'), 'utf8')); }
  catch { throw Error('COMPANY_DEPLOY_CONFIG_UNREADABLE'); }
  const matches = (config.functions || []).filter(fn => fn.name === name);
  if (config.envId !== 'cloudbase-d2g65rqbvee0bd978' || matches.length !== 1 || matches[0].dir) throw Error('COMPANY_DEPLOY_CONFIG_MISMATCH');
  const root = path.resolve(cwd, config.functionRoot || 'functions');
  const entry = path.join(root, name, 'index.js');
  const sourceEntry = path.join(__dirname, '../cloudfunctions', name, 'index.js');
  if (['account-api', 'account-bootstrap'].includes(name)) {
    const copy = path.join(root, name, 'account-names.js');
    if (!fs.existsSync(copy) || !fs.readFileSync(path.join(__dirname, '../server-shared/account-names.js')).equals(fs.readFileSync(copy))) throw Error('COMPANY_DEPLOY_ACCOUNT_NAMES_MISMATCH');
  }
  const usesRequestContext = file => fs.existsSync(file) && /require\(['"]\.\/request-context['"]\)/.test(fs.readFileSync(file, 'utf8'));
  const stagedUsesRequestContext = usesRequestContext(entry);
  if (usesRequestContext(sourceEntry) && !stagedUsesRequestContext) throw Error('COMPANY_DEPLOY_REQUEST_CONTEXT_ENTRY_MISMATCH');
  if (stagedUsesRequestContext) {
    const copy = path.join(root, name, 'request-context.js');
    const source = fs.readFileSync(path.join(__dirname, '../server-shared/request-context.js'));
    if (!fs.existsSync(copy) || !source.equals(fs.readFileSync(copy))) throw Error('COMPANY_DEPLOY_REQUEST_CONTEXT_MISMATCH');
  }
  // Online package installation cannot supply missing application source files.
  if (!fs.existsSync(entry) || require('./local-module-audit').inspectLocalModules(path.dirname(entry)).length) {
    throw Error('COMPANY_DEPLOY_LOCAL_MODULES_INVALID');
  }
  if (installs[0] === 'true') return;
  const result = spawnSync(process.execPath, [path.join(__dirname, 'audit-function-runtime-dependencies.js'), '--root', root, name], {
    cwd, encoding: 'utf8', timeout: 40000
  });
  if (result.status !== 0) throw Error('COMPANY_DEPLOY_RUNTIME_DEPENDENCIES_INVALID');
}

module.exports = { preflight };
