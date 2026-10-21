const fs = require('node:fs');
const { prepareTaxProfileReview } = require('./prepare-tax-profile-review');
const { bindTaxpayerIdentity } = require('./bind-taxpayer-identity');

async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (argv.length !== 2 || !['--prepare','--bind'].includes(argv[0])) throw Error('TAX_PREPARE_ARGUMENTS_INVALID');
  const binding = argv[0] === '--bind';
  const config = JSON.parse(env.ORDER_MYSQL_CONFIG || 'null');
  if (!config?.host || !config.database || !config.user || typeof config.password !== 'string'
    || config.user === 'am_payment') throw Error('TAX_PREPARE_CONFIG_REQUIRED');
  if (env.TAX_PROFILE_CONFIG && env.TAX_PROFILE_CONFIG_B64) throw Error('TAX_PREPARE_CONFIG_REQUIRED');
  const secret = JSON.parse(env.TAX_PROFILE_CONFIG_B64
    ? Buffer.from(env.TAX_PROFILE_CONFIG_B64, 'base64').toString('utf8') : env.TAX_PROFILE_CONFIG || 'null');
  if (!/^[a-f0-9]{64}$/.test(secret?.encryptionKeyHex || '')
    || !/^[A-Za-z0-9_-]{1,64}$/.test(secret?.keyId || '')) throw Error('TAX_PREPARE_CONFIG_REQUIRED');
  const input = JSON.parse((dependencies.readFileSync || fs.readFileSync)(argv[1], 'utf8'));
  const fields = binding ? ['scope','verification'] : ['scope','classification'];
  if (!input || Object.keys(input).some(k => !fields.includes(k))) throw Error('TAX_PREPARE_INPUT_INVALID');
  if (binding && (!/^[a-f0-9]{64}$/.test(env.TAX_IDENTITY_INDEX_KEY_HEX || '')
    || env.TAX_IDENTITY_INDEX_KEY_HEX === secret.encryptionKeyHex
    || !/^[A-Za-z0-9_-]{1,64}$/.test(env.TAX_REVIEW_OPERATOR_ID || '')
    || !input.verification || Object.keys(input.verification).some(k => !['identityVerified','evidenceReference','verifiedIdentity'].includes(k)))) {
    throw Error('TAX_PREPARE_CONFIG_REQUIRED');
  }
  const createPool = dependencies.createPool || require('../cloudfunctions/payment-api/node_modules/mysql2/promise').createPool;
  const pool = createPool({ host: config.host, port: config.port || 3306, database: config.database,
    user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(config.ca ? { ca: config.ca } : {}) },
    connectionLimit: 1, multipleStatements: false });
  try {
    if (binding) {
      const result = await (dependencies.bind || bindTaxpayerIdentity)(pool,input.scope,
        {...input.verification,operator:env.TAX_REVIEW_OPERATOR_ID},
        {keyId:secret.keyId,key:Buffer.from(secret.encryptionKeyHex,'hex')},Buffer.from(env.TAX_IDENTITY_INDEX_KEY_HEX,'hex'));
      return {submissionId:result.submissionId,taxpayerReference:result.taxpayerReference};
    }
    const result = await (dependencies.prepare || prepareTaxProfileReview)(pool, input.scope, input.classification,
      { keyId: secret.keyId, key: Buffer.from(secret.encryptionKeyHex, 'hex') });
    return { profileVersionId: result.profileVersionId, status: result.status };
  } finally { await pool.end(); }
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error('TAX_PREPARE_FAILED'); process.exitCode = 1;
});
module.exports = { main };
