// Reuses the privileged review-provider connection pattern. No public cloud action.
const fs = require('node:fs');
const { reviewTaxProfile } = require('./tax-profile-review-core');
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode !== '--review' || !file) throw Error('Use --review <decision.json>');
  const config = JSON.parse(process.env.ORDER_MYSQL_CONFIG || 'null');
  const operator = process.env.TAX_REVIEW_OPERATOR_ID;
  if (!config?.host || !config.database || !config.user || typeof config.password !== 'string'
    || !operator) throw Error('TAX_REVIEW_CONFIG_REQUIRED');
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = require('../cloudfunctions/payment-api/node_modules/mysql2/promise').createPool({
    host: config.host, port: config.port || 3306, database: config.database, user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(config.ca ? { ca: config.ca } : {}) },
    connectionLimit: 1, multipleStatements: false
  });
  try { console.log(JSON.stringify(await reviewTaxProfile(pool, input, operator))); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('TAX_REVIEW_FAILED'); process.exitCode = 1; });
module.exports = { main };
