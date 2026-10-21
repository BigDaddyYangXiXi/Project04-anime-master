// Build a deployment-only copy; preserve installed dependency versions and live settings.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, '../prototype/node_modules/esbuild'));
const name = process.argv[2] || 'account-api';
if (!['account-api', 'account-bootstrap', 'catalog-read', 'availability-api', 'order-api'].includes(name)) throw Error('UNSUPPORTED_FUNCTION');
const artifactName = name === 'account-api' ? 'account' : name;
const source = path.join(root, 'cloudfunctions', name);
const stageRoot = path.join(root, '.artifacts/account-sdk-functions');
const destination = path.join(stageRoot, name);
if (fs.existsSync(destination)) throw Error('STAGING_ALREADY_EXISTS');
const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json')));
const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'api', 'scf', 'GetFunction',
  '--api-version', '2018-04-16', '--body', JSON.stringify({ FunctionName: name, Namespace: config.envId, ShowCode: 'FALSE' }), '--json'],
{ cwd: root, encoding: 'utf8', timeout: 60000 });
let live;
try { live = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)).data; } catch {}
if (run.status !== 0 || live?.Status !== 'Active' || live.Runtime !== 'Nodejs20.19') throw Error('LIVE_CONFIG_UNCONFIRMED');
const fn = config.functions.find(item => item.name === name);
fn.envVariables = Object.fromEntries((live.Environment?.Variables || []).map(item => [item.Key, item.Value]));
fn.memorySize = live.MemorySize; fn.timeout = live.Timeout;
if (live.VpcConfig?.VpcId) fn.vpc = { vpcId: live.VpcConfig.VpcId, subnetId: live.VpcConfig.SubnetId };
else delete fn.vpc;
if (!['ENABLE', 'DISABLE'].includes(live.PublicNetConfig?.PublicNetStatus)) throw Error('LIVE_NETWORK_UNCONFIRMED');
if (live.PublicNetConfig.EipConfig?.EipStatus !== 'DISABLE') throw Error('UNEXPECTED_EIP_CONFIGURATION');
fn.publicNetConfig = { PublicNetStatus: live.PublicNetConfig.PublicNetStatus, EipConfig: { EipStatus: 'DISABLE' } };
config.functionRoot = '.artifacts/account-sdk-functions'; config.functions = [fn];
fs.mkdirSync(stageRoot, { recursive: true });
fs.cpSync(source, destination, { recursive: true });
fs.mkdirSync(path.join(destination, 'vendor/dist/utils'), { recursive: true });
const packagePath = path.join(source, 'node_modules/@cloudbase/node-sdk/package.json');
fs.copyFileSync(packagePath, path.join(destination, 'vendor/package.json'));
const sdkEntry = require.resolve('@cloudbase/node-sdk', { paths: [source] });
const output = path.join(destination, 'vendor/dist/utils/cloudbase.cjs');
const built = esbuild.buildSync({ entryPoints: [sdkEntry], outfile: output, bundle: true, platform: 'node', target: 'node20', format: 'cjs', metafile: true });
const originalSdk = require(sdkEntry), bundledSdk = require(output);
if (originalSdk.version !== bundledSdk.version || JSON.stringify(Object.keys(originalSdk).sort()) !== JSON.stringify(Object.keys(bundledSdk).sort())) throw Error('SDK_EXPORT_MISMATCH');
const entry = path.join(destination, 'index.js');
const before = fs.readFileSync(entry, 'utf8');
if (before.split('require("@cloudbase/node-sdk")').length !== 2) throw Error('ENTRY_REQUIRE_MISMATCH');
fs.writeFileSync(entry, before.replace('require("@cloudbase/node-sdk")', 'require("./vendor/dist/utils/cloudbase.cjs")'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { name, sdkVersion: bundledSdk.version, inputFiles: Object.keys(built.metafile.inputs).length,
  bundledBytes: fs.statSync(output).size, sourceEntrySha256: hash(path.join(source, 'index.js')), deployedEntrySha256: hash(entry),
  bundleSha256: hash(output), memorySize: fn.memorySize, timeout: fn.timeout, configurationPreserved: true, deployed: false };
fs.writeFileSync(path.join(root, `.artifacts/${artifactName}-sdk-bundle-manifest.json`), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, `.artifacts/${artifactName}-sdk-bundle-metafile.json`), JSON.stringify(built.metafile));
fs.writeFileSync(path.join(root, `.cloudbase-cli-config/${artifactName}-sdk-deploy.json`), JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
