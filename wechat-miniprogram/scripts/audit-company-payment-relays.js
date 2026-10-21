// Cloud metadata and closed-entry checks only. Never enables or submits a payment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const envId = 'cloudbase-d2g65rqbvee0bd978';
const configurationOnly = process.argv.includes('--configuration-only');
const configured = process.argv.includes('--merchant-configured');
const enabledNames = new Set([
  ...(process.argv.includes('--query-enabled') ? ['payment-query-relay'] : []),
  ...(process.argv.includes('--guard-enabled') ? ['payment-mutation-guard'] : [])
]);
if (enabledNames.size && !configured) throw Error('CONFIGURED_MERCHANT_REQUIRED');
const outputFile = path.join(root, `.artifacts/company-payment-relay-${configured ? 'merchant-' : ''}${configurationOnly ? 'configuration' : 'audit'}.json`);
let phase = 'initial';
const reports = [];
function cli(args) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  if (run.status !== 0 || !result?.data || result.error) throw Error('PAYMENT_RELAY_AUDIT_CALL_FAILED');
  return result.data;
}
try {
  for (const name of ['payment-mutation-guard', 'payment-query-relay', 'payment-mutation-relay']) {
    const expected = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config', configured
      ? `merchant-configured-closed/${name}${enabledNames.has(name) ? '-enabled' : ''}.json` : `${name}-closed-deploy.json`)));
    assert.equal(expected.envId, envId);
    const [fn] = expected.functions;
    assert.equal(fn.name, name);
    phase = `${name}:read-configuration`;
    const actual = cli(['api', 'scf', 'GetFunction', '--api-version', '2018-04-16', '--body',
      JSON.stringify({ FunctionName: name, Namespace: envId, ShowCode: 'FALSE' })]);
    phase = `${name}:check-configuration`;
    const vars = Object.fromEntries((actual.Environment?.Variables || []).map(v => [v.Key, v.Value]));
    // No raw response or assertion message is printed; both may contain private database credentials.
    assert.equal(actual.Status, 'Active');
    assert.equal(actual.Handler, fn.handler);
    assert.equal(actual.Runtime, fn.runtime);
    assert.deepEqual(actual.Triggers, []);
    assert.deepEqual(vars, fn.envVariables);
    assert.equal(actual.PublicNetConfig?.PublicNetStatus, fn.publicNetConfig.PublicNetStatus);
    assert.equal(actual.PublicNetConfig?.EipConfig?.EipStatus, 'DISABLE');
    assert.equal(actual.VpcConfig?.VpcId || '', fn.vpc.vpcId);
    assert.equal(actual.VpcConfig?.SubnetId || '', fn.vpc.subnetId);
    const key = `PAYMENT_${name.slice(8).replaceAll('-', '_').toUpperCase()}_CONFIG_B64`;
    const config = JSON.parse(Buffer.from(vars[key], 'base64').toString());
    assert.equal(config.enabled, enabledNames.has(name));
    if (configured) {
      assert.equal(config.platformMchid, '1750932981');
      assert.equal(config.wechatPublicKeyId, 'PUB_KEY_ID_0117509329812026092500181593000200');
      assert.ok(config.merchantPublicKey?.startsWith('-----BEGIN PUBLIC KEY-----'));
      assert.equal(config.merchantPrivateKey, undefined);
      assert.equal(config.apiV3Key, undefined);
    }
    if (name !== 'payment-query-relay') assert.equal(config.mutationsEnabled, enabledNames.has(name));
    if (configurationOnly) {
      reports.push({ name, active: true, enabled: enabledNames.has(name), configurationMatched: true, invalidEntryRejected: null });
      continue;
    }
    phase = `${name}:closed-invocation`;
    // Use the same native SCF API transport as the metadata check; legacy fn invoke timed out.
    const invocation = cli(['api', 'scf', 'Invoke', '--api-version', '2018-04-16', '--body',
      JSON.stringify({ FunctionName: name, Namespace: envId, ClientContext: '{}', LogType: 'Tail' })]);
    assert.equal(invocation.Result?.InvokeResult, 0);
    const result = JSON.parse(invocation.Result.RetMsg);
    phase = `${name}:check-closed-result`;
    assert.deepEqual(result, { ok: false, code: name === 'payment-mutation-guard' ? 'PAYMENT_MUTATION_GUARD_FAILED' : 'PAYMENT_RELAY_FAILED' });
    reports.push({ name, active: true, enabled: enabledNames.has(name), configurationMatched: true, invalidEntryRejected: true, requestId: invocation.RequestId });
  }
  const report = { checkedAt: new Date().toISOString(), ok: true, configurationOnly, reports,
    scope: 'Configuration and invalid-entry rejection only; no valid signature, SQL write or payment acceptance.' };
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  const report = { checkedAt: new Date().toISOString(), ok: false, code: 'COMPANY_PAYMENT_RELAY_AUDIT_FAILED', phase, reports };
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report)); process.exitCode = 1;
}
