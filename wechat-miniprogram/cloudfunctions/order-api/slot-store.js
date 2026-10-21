function fail(code) { const error = new Error(code); error.code = code; throw error; }

const OCCUPIED_STAGES = ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"];
function segments(row) {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const value = payload && payload.public && payload.public.timeSegments;
  if (!Array.isArray(value) || !value.length || value.some(item => !Number.isSafeInteger(item.startsAt)
    || !Number.isSafeInteger(item.endsAt) || item.startsAt >= item.endsAt)) fail("INVALID_TIME_SEGMENTS");
  return value;
}

// Internal writer: row/next are produced by order-core after identity, role and condition checks.
// A dedicated mutex row serializes confirmations without granting account/qualification writes.
async function confirmWithSlots(pool, row, next) {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.beginTransaction();
    const [[provider]] = await connection.execute("SELECT id FROM accounts WHERE id = ? FOR SHARE", [row.provider_id]);
    if (!provider) fail("PROVIDER_NOT_AVAILABLE");
    const [[qualification]] = await connection.execute("SELECT status FROM provider_qualifications WHERE provider_id = ? FOR SHARE", [row.provider_id]);
    if (qualification && qualification.status === "SUSPENDED") fail("PROVIDER_NOT_AVAILABLE");
    await connection.execute("INSERT INTO provider_slot_locks (provider_id) VALUES (?) ON DUPLICATE KEY UPDATE provider_id = VALUES(provider_id)", [row.provider_id]);
    const [[current]] = await connection.execute("SELECT * FROM order_aggregates WHERE id = ? FOR UPDATE", [row.id]);
    if (!current || current.provider_id !== row.provider_id || current.buyer_id !== row.buyer_id
      || current.request_hash !== row.request_hash) fail("ORDER_NOT_FOUND");
    if (Number(current.version) !== Number(row.version) || current.stage !== "CONTACTING") fail("VERSION_CONFLICT");
    if (!["NDA_BUYER_PENDING", "BUYER_FINAL_CONFIRM"].includes(next.stage)
      || next.version !== Number(current.version) + 1) fail("ILLEGAL_TRANSITION");
    const requested = segments(current);
    const [occupied] = await connection.execute(
      `SELECT stage,payload FROM order_aggregates WHERE provider_id = ? AND id <> ? AND stage IN (${OCCUPIED_STAGES.map(() => "?").join(",")}) FOR UPDATE`,
      [current.provider_id, current.id, ...OCCUPIED_STAGES]);
    if (occupied.filter(other => {
      const payload = typeof other.payload === "string" ? JSON.parse(other.payload) : other.payload;
      return !(["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(other.stage)
        && payload.public.ndaFlowVersion === 2 && payload.public.communicationDone === false);
    }).some(other => segments(other).some(existing => requested.some(item =>
      item.startsAt < existing.endsAt && existing.startsAt < item.endsAt)))) fail("SCHEDULE_CONFLICT");
    await connection.execute("UPDATE order_aggregates SET payload = ?, stage = ?, version = ?, updated_at = ? WHERE id = ?",
      [next.payload, next.stage, next.version, next.updated_at, current.id]);
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally {
    if (reusable) connection.release(); else connection.destroy();
  }
}

module.exports = { confirmWithSlots };
