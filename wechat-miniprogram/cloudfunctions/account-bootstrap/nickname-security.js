// Kept identical in account-api: each cloud function is deployed independently.
function fail(code) { const error = new Error(code); error.code = code; throw error; }

async function checkNickname(nickname, openid, check) {
  if (!openid) fail("AUTH_CONTEXT_MISSING");
  let response;
  try {
    response = await check({ content: nickname, nickname, openid, scene: 1, version: 2 });
  } catch (_) {
    fail("NICKNAME_CHECK_UNAVAILABLE");
  }
  const code = response && (response.errCode ?? response.errcode);
  if (code !== 0) fail("NICKNAME_CHECK_UNAVAILABLE");
  const suggestion = response.result && response.result.suggest;
  if (suggestion === "risky") fail("NICKNAME_REJECTED");
  if (suggestion === "review") fail("NICKNAME_REVIEW_REQUIRED");
  if (suggestion !== "pass") fail("NICKNAME_CHECK_UNAVAILABLE");
}

async function reviewNickname(nickname, openid) {
  return checkNickname(nickname, openid, async (request) => {
    const cloud = require("wx-server-sdk");
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    return cloud.openapi.security.msgSecCheck(request);
  });
}

module.exports = { checkNickname, reviewNickname };
