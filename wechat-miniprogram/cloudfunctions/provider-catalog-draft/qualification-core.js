const { resolveProvider } = require("./draft-core");
function fail(code) { const error = new Error(code); error.code = code; throw error; }
// Compatibility for installed clients. Retired actions never create or approve applications.
async function handleQualification(db, event, context) {
  await resolveProvider(db, context);
  if (!["getQualification", "submitQualification"].includes(event.action)) fail("INVALID_ACTION");
  return { status: "NOT_REQUIRED", career: "", reviewNote: "无需申请入驻资格；内容检测通过后可发布橱窗。", version: 0 };
}
module.exports = { handleQualification };
