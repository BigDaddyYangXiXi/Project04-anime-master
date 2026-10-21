// Operator-only entry. Credentials stay in the environment; decision files stay outside source control.
const fs = require("node:fs");
const { reviewQualification } = require("./qualification-review-core");
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!["--list", "--review"].includes(mode) || mode === "--review" && !file) throw new Error("Use --list or --review <decision.json>");
  const config = JSON.parse(process.env.ORDER_MYSQL_CONFIG || "null");
  if (!config || !config.host || !config.database || !config.user || typeof config.password !== "string") throw new Error("ORDER_MYSQL_CONFIG required");
  const pool = require("../cloudfunctions/payment-api/node_modules/mysql2/promise").createPool({
    host: config.host, port: config.port || 3306, database: config.database, user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(config.ca ? { ca: config.ca } : {}) },
    connectionLimit: 1, multipleStatements: false
  });
  try {
    if (mode === "--list") {
      const [rows] = await pool.execute("SELECT provider_id,career,status,application,version,submitted_at FROM provider_qualifications WHERE status='PENDING' ORDER BY submitted_at");
      console.log(JSON.stringify(rows, null, 2));
    } else console.log(JSON.stringify(await reviewQualification(pool, JSON.parse(fs.readFileSync(file, "utf8")))));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.code || "REVIEW_FAILED"); process.exitCode = 1; });
