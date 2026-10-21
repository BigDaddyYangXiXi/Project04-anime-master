const crypto = require("node:crypto");
function fail(code) { const error = new Error(code); error.code = code; throw error; }
// Privileged operator tool only. Never expose this writer as a Mini Program cloud action.
async function reviewQualification(pool, input, now = Date.now()) {
  if (!input || !/^[A-Za-z0-9_-]{1,64}$/.test(input.providerId || "")
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
    || !["APPROVED", "REJECTED", "SUSPENDED"].includes(input.decision)
    || !["reviewedBy", "note", "evidenceReference"].every(key => typeof input[key] === "string" && input[key].trim())
    || input.reviewedBy.length > 128 || input.note.length > 500 || input.evidenceReference.length > 255
    || input.decision === "APPROVED" && input.eligibilityVerified !== true) fail("REVIEW_INPUT_INVALID");
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM accounts WHERE id = ? FOR UPDATE", [input.providerId]);
    const [[current]] = await connection.execute("SELECT * FROM provider_qualifications WHERE provider_id = ? FOR UPDATE", [input.providerId]);
    if (!current || Number(current.version) !== input.expectedVersion) fail("VERSION_CONFLICT");
    if (input.career !== current.career) fail("REVIEW_CAREER_MISMATCH");
    if (input.decision === "APPROVED" && current.status !== "PENDING") fail("REVIEW_STATE_INVALID");
    const version = input.expectedVersion + 1;
    await connection.execute("UPDATE provider_qualifications SET status=?,eligibility_verified=?,reviewed_by=?,review_note=?,evidence_reference=?,reviewed_at=?,version=? WHERE provider_id=?",
      [input.decision, input.decision === "APPROVED" ? 1 : 0, input.reviewedBy, input.note, input.evidenceReference, now, version, input.providerId]);
    await connection.execute("INSERT INTO provider_qualification_reviews (id,provider_id,qualification_version,decision,reviewed_by,review_note,evidence_reference,reviewed_at) VALUES (?,?,?,?,?,?,?,?)",
      [crypto.randomBytes(16).toString("hex"), input.providerId, version, input.decision, input.reviewedBy, input.note, input.evidenceReference, now]);
    await connection.commit();
    return { providerId: input.providerId, status: input.decision, version };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { reviewQualification };
