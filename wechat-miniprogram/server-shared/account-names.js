const crypto = require('node:crypto');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function nicknameKey(value) {
  return crypto.createHash('sha256').update(value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()).digest('hex');
}
function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{2,12}$/.test(value)) fail('INVALID_USERNAME');
  return value;
}
async function checkNames(db, nickname, username, accountId) {
  for (const [field, value, code] of [['nickname_key', nicknameKey(nickname), 'NICKNAME_TAKEN'], ['username', normalizeUsername(username), 'USERNAME_TAKEN']]) {
    const result = await db.from('accounts').select('id').eq(field, value);
    if (result?.error) fail('DATABASE_OPERATION_FAILED');
    if ((result?.data || []).some(row => row.id !== accountId)) fail(code);
  }
}
module.exports = { nicknameKey, normalizeUsername, checkNames };
