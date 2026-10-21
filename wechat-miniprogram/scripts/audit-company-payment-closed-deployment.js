// Never print the raw GetFunction response: it contains database credentials.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const name = process.argv[2] || 'payment-api';
if (!['payment-api', 'payment-notify', 'payment-refund-notify'].includes(name)) throw Error('PAYMENT_AUDIT_TARGET_INVALID');
const configured = process.argv.includes('--merchant-configured');
if (name === 'payment-refund-notify' && !configured) throw Error('REFUND_NOTIFY_REQUIRES_MERCHANT_CONFIG');
const expected = JSON.parse(fs.readFileSync(configured ? `.cloudbase-cli-config/merchant-configured-closed/${name}.json` : name === 'payment-notify'
  ? '.cloudbase-cli-config/company-payment-notify-closed-deploy.json' : '.cloudbase-cli-config/company-payment-closed-deploy.json'));
const fn = expected.functions.find(item => item.name === name);
if (expected.envId !== 'cloudbase-d2g65rqbvee0bd978' || !fn) throw Error('PAYMENT_AUDIT_TARGET_INVALID');
const run = spawnSync(process.execPath, ['scripts/cloudbase-company-cli.js', 'api', 'scf', 'GetFunction',
  '--api-version', '2018-04-16', '--body', JSON.stringify({ FunctionName: name, Namespace: expected.envId, ShowCode: 'FALSE' }), '--json'], { encoding: 'utf8', timeout: 60000 });
try {
  const data = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)).data;
  if (run.status !== 0 || !data) throw Error('PAYMENT_DEPLOYMENT_QUERY_FAILED');
  const env = Object.fromEntries(data.Environment.Variables.map(item => [item.Key, item.Value]));
  const config = JSON.parse(Buffer.from(env.PAYMENT_WECHAT_CONFIG_B64, 'base64').toString('utf8'));
  const checks = { active: data.Status === 'Active', handlerMatched: data.Handler === fn.handler,
    vpcMatched: data.VpcConfig.VpcId === fn.vpc.vpcId && data.VpcConfig.SubnetId === fn.vpc.subnetId,
    publicNetworkDisabled: data.PublicNetConfig?.PublicNetStatus === 'DISABLE',
    fixedIpDisabled: data.PublicNetConfig?.EipConfig?.EipStatus === 'DISABLE',
    databaseConfigMatched: env.PAYMENT_MYSQL_CONFIG_B64 === fn.envVariables.PAYMENT_MYSQL_CONFIG_B64,
    paymentConfigMatched: env.PAYMENT_WECHAT_CONFIG_B64 === fn.envVariables.PAYMENT_WECHAT_CONFIG_B64,
    moneyActionsClosed: ['prepayEnabled', 'closeEnabled', 'settlementEnabled', 'settlementExecutionEnabled',
      'settlementPreparationEnabled', 'reconciliationEnabled'].every(key => config[key] === false),
    refundActionsClosed: ['refundRequestsEnabled', 'refundEnabled', 'refundReconciliationEnabled'].every(key => config[key] !== true),
    directMode: config.paymentMode === 'DIRECT',
    ...(configured ? { merchantMatched: config.platformMchid === '1750932981',
      merchantMaterialPresent: !!config.merchantPrivateKey && typeof config.apiV3Key === 'string' && config.apiV3Key.length === 32,
      publicKeyMatched: config.wechatPublicKeyId === 'PUB_KEY_ID_0117509329812026092500181593000200' && !!config.publicKeys?.[config.wechatPublicKeyId] } : {}),
    appidMatched: config.appid === 'wxc94e1c1b38944511', noTriggers: data.Triggers.length === 0 };
  const ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ name, checkedAt: new Date().toISOString(), ok, checks }));
  if (!ok) process.exitCode = 1;
} catch {
  console.error('PAYMENT_CLOSED_DEPLOYMENT_AUDIT_FAILED'); process.exitCode = 1;
}
