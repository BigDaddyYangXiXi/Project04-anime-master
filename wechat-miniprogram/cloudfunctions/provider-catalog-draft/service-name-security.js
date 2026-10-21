function fail(code) { const error = new Error(code); error.code = code; throw error; }
async function reviewServiceNames(services, openid, check) {
  if (!openid) fail('AUTH_CONTEXT_MISSING');
  const names = [...new Set(services.map(service => service.name).filter(Boolean))];
  if (!names.length) return;
  let response;
  try {
    if (!check) {
      const cloud = require('wx-server-sdk');
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      check = request => cloud.openapi.security.msgSecCheck(request);
    }
    response = await check({ content: names.join('\n'), openid, scene: 2, version: 2 });
  } catch (_) { fail('SERVICE_NAME_CHECK_UNAVAILABLE'); }
  if ((response?.errCode ?? response?.errcode) !== 0) fail('SERVICE_NAME_CHECK_UNAVAILABLE');
  if (['risky', 'review'].includes(response.result?.suggest)) fail('SERVICE_NAME_REJECTED');
  if (response.result?.suggest !== 'pass') fail('SERVICE_NAME_CHECK_UNAVAILABLE');
}
module.exports = { reviewServiceNames };
