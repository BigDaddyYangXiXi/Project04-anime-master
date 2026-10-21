const cloudCall = require("../utils/cloud-call");
const orders = require('./cloud-orders');
const localPreview = require('../utils/local-preview');
function fail(code) { const error = Error('暂时无法查询税务资料状态'); error.code = code; throw error; }
async function getStatus() {
  if (!orders.isAvailable()) fail('CLOUD_UNAVAILABLE');
  localPreview.assertCloudAllowed();
  let response;
  try { response = await cloudCall.call(wx, { name: 'payment-api', data: { action: 'getTaxProfileStatus' } }); }
  catch { fail('TAX_STATUS_READ_FAILED'); }
  if (response?.result?.ok !== true) {
    const code = response?.result?.error?.code;
    fail(['TAX_STATUS_NOT_CONFIGURED','AUTH_CONTEXT_MISSING','ACCOUNT_NOT_FOUND'].includes(code) ? code : 'TAX_STATUS_READ_FAILED');
  }
  const data = response.result.data;
  if (!data || !['NOT_SUBMITTED','SUBMITTED','PENDING','VERIFIED','REJECTED','REVOKED'].includes(data.status)) fail('TAX_STATUS_RESPONSE_INVALID');
  // Only status is needed here. Do not copy identity or other unexpected fields to page data.
  return { status: data.status };
}
module.exports = { getStatus };
