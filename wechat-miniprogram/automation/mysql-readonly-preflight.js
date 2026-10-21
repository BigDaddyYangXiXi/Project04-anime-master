const path = require('node:path');
const REQUIRED_TABLES = ['accounts', 'wechat_identities', 'provider_qualifications', 'order_aggregates',
  'provider_payment_merchants', 'order_payments', 'order_settlement_tasks', 'order_funds_interlocks', 'payment_mutation_receipts',
  'order_refunds', 'order_refund_reversals', 'fund_journals', 'fund_postings', 'finance_result_imports', 'finance_net_settlements',
  'bank_settlement_batches', 'bank_settlement_sources', 'withdrawal_requests', 'withdrawal_bank_payments',
  'withdrawal_receipt_events', 'withdrawal_sources'];
function fail(code) { const error = new Error(code); error.code = code; throw error; }
const REQUIRED_COLUMNS = {
  bank_settlement_batches: { id:'char(32)', request_key:'varchar(128)', appid:'varchar(64)', platform_mchid:'varchar(32)', request_hash:'char(64)', created_by:'varchar(64)', created_at:'bigint unsigned', status:"enum('RESERVED_DRAFT','CANCELLED')", cancelled_by:'varchar(64)', cancelled_at:'bigint unsigned', cancellation_reason:'varchar(255)' },
  bank_settlement_sources: { batch_id:'char(32)', payment_id:'char(32)', order_id:'varchar(64)', provider_id:'varchar(64)', provider_pretax_fen:'bigint unsigned', snapshot:'json', released_at:'bigint unsigned', reserved_payment_id:'char(32)', reserved_order_id:'varchar(64)' },
  withdrawal_requests: { id:'char(32)', appid:'varchar(64)', platform_mchid:'varchar(32)', provider_id:'varchar(64)', requested_net_fen:'bigint unsigned', approved_net_fen:'bigint unsigned', approval_reference:'varchar(128)', approved_by:'varchar(64)', approved_at:'bigint unsigned', created_at:'bigint unsigned' },
  withdrawal_bank_payments: { id:'char(32)', withdrawal_id:'char(32)', amount_fen:'bigint unsigned', status:"enum('RESERVED','EXPORTED','PROCESSING','UNKNOWN','SUCCEEDED','FAILED','CANCELLED')", created_by:'varchar(64)', account_version_id:'char(32)', evidence_reference:'varchar(128)', created_at:'bigint unsigned', updated_at:'bigint unsigned' },
  withdrawal_receipt_events: { id:'char(32)', payment_id:'char(32)', platform_mchid:'varchar(32)', bank_transaction_reference:'varchar(128)', input_sha256:'char(64)', previous_status:'varchar(16)', resulting_status:"enum('PROCESSING','UNKNOWN','SUCCEEDED','FAILED')", operator_id:'varchar(64)', evidence_reference:'varchar(128)', created_at:'bigint unsigned' },
  withdrawal_sources: { withdrawal_id:'char(32)', payment_id:'char(32)', amount_fen:'bigint unsigned' },
  finance_result_imports: { id:'char(32)', appid:'varchar(64)', platform_mchid:'varchar(64)', result_id:'varchar(128)', batch_id:'char(32)', source_sha256:'char(64)', result_sha256:'char(64)', result_snapshot:'json', created_by:'varchar(128)', created_at:'bigint unsigned' },
  finance_net_settlements: { payment_id:'char(32)', import_id:'char(32)', journal_id:'varchar(80)', provider_id:'varchar(64)', source_sha256:'char(64)', provider_pretax_fen:'bigint unsigned', income_tax_fen:'bigint unsigned', vat_fen:'bigint unsigned', surcharge_fen:'bigint unsigned', provider_net_fen:'bigint unsigned', approved_by:'varchar(64)', approved_at:'bigint unsigned' },
  order_payments: { payment_mode: "enum('COMBINE','DIRECT')", prepay_id: 'varchar(128)', prepay_started_at: 'bigint unsigned',
    prepay_lease_until: 'bigint unsigned', prepay_lease_token: 'char(32)', prepay_recovery_started_at: 'bigint unsigned',
    query_started_at: 'bigint unsigned', query_lease_until: 'bigint unsigned', query_lease_token: 'char(32)',
    refunded_fen: 'bigint unsigned', platform_refunded_fen: 'bigint unsigned', provider_refunded_fen: 'bigint unsigned' },
  order_settlement_tasks: { request_snapshot: 'json', channel_order_id: 'varchar(64)', channel_result: 'json', verified_at: 'bigint unsigned' },
  order_funds_interlocks: { order_id: 'varchar(64)', hold_reason: 'varchar(24)', held_at: 'bigint unsigned',
    settlement_task_id: 'char(32)', settlement_started_at: 'bigint unsigned' },
  payment_mutation_receipts: { request_hash: 'char(64)', consumed_at: 'bigint unsigned' },
  order_refunds: { id: 'char(32)', order_id: 'varchar(64)', payment_id: 'char(32)', request_key: 'varchar(128)',
    status: "enum('REQUESTED','APPROVED','REJECTED','SUBMITTING','PROCESSING','SUCCESS','CLOSED','ABNORMAL')",
    amount_fen: 'bigint unsigned', total_fen: 'bigint unsigned', platform_fee_fen: 'bigint unsigned',
    submission_started_at: 'bigint unsigned', submission_lease_token: 'char(32)', submission_lease_until: 'bigint unsigned',
    channel_refund_id: 'varchar(64)', succeeded_at: 'bigint unsigned',
    query_started_at: 'bigint unsigned', query_lease_until: 'bigint unsigned', query_lease_token: 'char(32)' },
  order_refund_reversals: { refund_id: 'char(32)', payment_id: 'char(32)', refund_fen: 'bigint unsigned',
    cumulative_refund_fen: 'bigint unsigned', platform_reversal_fen: 'bigint unsigned', provider_reversal_fen: 'bigint unsigned' },
  fund_journals: { id: 'varchar(80)', payment_id: 'char(32)', refund_id: 'char(32)', reverses_journal_id: 'varchar(80)',
    provider_id: 'varchar(64)', event_type: "enum('PAYMENT_CONFIRMED','REFUND_SUCCEEDED','PAYMENT_REVIEW_RECEIVED','FINANCE_NET_APPROVED')" },
  fund_postings: { journal_id: 'varchar(80)', account: "enum('CHANNEL_RECEIVABLE','PLATFORM_PENDING','PROVIDER_PENDING','REVIEW_SUSPENSE','INCOME_TAX_PAYABLE','VAT_PAYABLE','SURCHARGE_PAYABLE','PROVIDER_NET')",
    direction: "enum('DEBIT','CREDIT')", amount_fen: 'bigint unsigned' }
};
const REQUIRED_INDEXES = {
  bank_settlement_batches: [{unique:true,columns:['id']},{unique:true,columns:['appid','platform_mchid','request_key']}],
  bank_settlement_sources: [{unique:true,columns:['batch_id','payment_id']},{unique:true,columns:['reserved_payment_id']},{unique:true,columns:['reserved_order_id']}],
  withdrawal_requests: [{unique:true,columns:['id']},{unique:false,columns:['appid','platform_mchid','provider_id','created_at']}],
  withdrawal_bank_payments: [{unique:true,columns:['id']},{unique:false,columns:['withdrawal_id','id']}],
  withdrawal_receipt_events: [{unique:true,columns:['id']},{unique:true,columns:['platform_mchid','bank_transaction_reference']},{unique:false,columns:['payment_id','created_at']}],
  withdrawal_sources: [{unique:true,columns:['withdrawal_id','payment_id']},{unique:false,columns:['payment_id','withdrawal_id']}],
  finance_result_imports: [{unique:true,columns:['id']},{unique:true,columns:['appid','platform_mchid','result_id']},{unique:false,columns:['appid','platform_mchid','batch_id','created_at']}],
  finance_net_settlements: [{unique:true,columns:['payment_id']},{unique:true,columns:['journal_id']},{unique:false,columns:['import_id']}],
  order_payments: [
    { unique: true, columns: ['order_id','request_key'] },
    { unique: true, columns: ['active_order_id'] },
    { unique: true, columns: ['transaction_id'] },
    { unique: false, columns: ['appid','platform_mchid','status','query_started_at','created_at','id'] }
  ],
  order_settlement_tasks: [
    { unique: true, columns: ['order_id'] }, { unique: true, columns: ['payment_id'] },
    { unique: true, columns: ['channel_order_id'] }
  ],
  order_funds_interlocks: [{ unique: true, columns: ['order_id'] }],
  payment_mutation_receipts: [{ unique: true, columns: ['request_hash'] }],
  order_refunds: [{ unique: true, columns: ['id'] }, { unique: true, columns: ['payment_id','request_key'] },
    { unique: true, columns: ['channel_refund_id'] }, { unique: false, columns: ['order_id','created_at','id'] },
    { unique: false, columns: ['platform_mchid','status','query_started_at','created_at','id'] }],
  order_refund_reversals: [{ unique: true, columns: ['refund_id'] }, { unique: false, columns: ['payment_id'] }],
  fund_journals: [{ unique: true, columns: ['id'] }, { unique: true, columns: ['refund_id'] }],
  fund_postings: [{ unique: true, columns: ['journal_id','account'] }]
};

async function inspectPaymentSchema(connection, database) {
  const names = Object.keys(REQUIRED_COLUMNS);
  const placeholders = names.map(() => '?').join(',');
  const [columns] = await connection.execute(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,
    COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (${placeholders})`, [database,...names]);
  const [indexes] = await connection.execute(`SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,
    NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (${placeholders})`, [database,...names]);
  const columnIssues = [];
  for (const [table, fields] of Object.entries(REQUIRED_COLUMNS)) for (const [name,type] of Object.entries(fields)) {
    const found = columns.find(row => row.tableName === table && row.columnName === name);
    if (!found || found.columnType !== type) columnIssues.push({ table, column: name, issue: found ? 'TYPE_MISMATCH' : 'MISSING' });
  }
  const indexIssues = [];
  for (const [table, rules] of Object.entries(REQUIRED_INDEXES)) {
    const groups = new Map();
    for (const row of indexes.filter(row => row.tableName === table)) {
      if (!groups.has(row.indexName)) groups.set(row.indexName, []);
      groups.get(row.indexName).push(row);
    }
    for (const rule of rules) {
      const found = [...groups.values()].some(rows => rows.length === rule.columns.length
        && rows.every(row => Number(row.nonUnique) === (rule.unique ? 0 : 1) && row.prefixLength == null)
        && rows.sort((a,b) => Number(a.sequence)-Number(b.sequence)).every((row,i) => row.columnName === rule.columns[i]));
      if (!found) indexIssues.push({ table, columns: rule.columns, unique: rule.unique });
    }
  }
  return { columnIssues, indexIssues };
}

async function inspectDatabase(config, createConnection) {
  if (!config || !['host', 'database', 'user', 'password'].every(key => typeof config[key] === 'string' && config[key])
    || (config.port !== undefined && (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535))
    || (config.ca !== undefined && (typeof config.ca !== 'string' || !config.ca.trim()))) fail('CONFIG_INVALID');
  const connection = await createConnection({ host: config.host, port: config.port || 3306,
    database: config.database, user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2', ...(config.ca ? { ca: config.ca } : {}) },
    connectTimeout: 5000, multipleStatements: false });
  try {
    const [tls] = await connection.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher', 'Ssl_version')");
    const values = Object.fromEntries(tls.map(row => [row.Variable_name, row.Value]));
    if (!values.Ssl_cipher || !['TLSv1.2', 'TLSv1.3'].includes(values.Ssl_version)) fail('TLS_NOT_VERIFIED');
    const [identity] = await connection.query('SELECT DATABASE() AS databaseName, @@version AS serverVersion');
    if (identity.length !== 1 || identity[0].databaseName !== config.database) fail('DATABASE_MISMATCH');
    const [tables] = await connection.execute(
      `SELECT TABLE_NAME AS tableName, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${REQUIRED_TABLES.map(() => '?').join(',')})`,
      [config.database, ...REQUIRED_TABLES]);
    const engines = new Map(tables.map(row => [row.tableName, row.engine]));
    const missingTables = REQUIRED_TABLES.filter(name => !engines.has(name));
    const nonTransactionalTables = REQUIRED_TABLES.filter(name => engines.has(name) && engines.get(name) !== 'InnoDB');
    const schema = await inspectPaymentSchema(connection, config.database);
    return { ok: !missingTables.length && !nonTransactionalTables.length && !schema.columnIssues.length && !schema.indexIssues.length, tlsVersion: values.Ssl_version,
      cipher: values.Ssl_cipher, serverVersion: identity[0].serverVersion, databaseMatched: true,
      missingTables, nonTransactionalTables, ...schema,
      scope: 'Read-only connection, engines and selected payment columns/indexes; permissions, complete constraints and transaction behavior require separate verification.' };
  } finally { await connection.end(); }
}

if (require.main === module) {
  (async () => {
    let config;
    try { config = JSON.parse(process.env.PAYMENT_MYSQL_CONFIG || 'null'); } catch { fail('CONFIG_INVALID'); }
    const createConnection = options => require(require.resolve('mysql2/promise', {
      paths: [path.resolve(__dirname, '../cloudfunctions/payment-api')]
    })).createConnection(options);
    const result = await inspectDatabase(config, createConnection);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  })().catch(error => {
    const known = ['CONFIG_INVALID', 'TLS_NOT_VERIFIED', 'DATABASE_MISMATCH'];
    console.error(JSON.stringify({ ok: false, code: known.includes(error.code) ? error.code : 'DATABASE_PREFLIGHT_FAILED' }));
    process.exitCode = 1;
  });
}
module.exports = { inspectDatabase, inspectPaymentSchema, REQUIRED_TABLES, REQUIRED_COLUMNS, REQUIRED_INDEXES };
