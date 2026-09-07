const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refreshPayment } = require('./payment-refresh');
for (const [name, event, caller] of [
  ['missing trusted caller', {action:'refreshPayment',orderId:'order_1'}, {}],
  ['client supplied identity', {action:'refreshPayment',orderId:'order_1',openid:'forged'}, {}],
  ['invalid action', {action:'pay',orderId:'order_1'}, {WX_OPENID:'openid',WX_APPID:'app'}],
  ['invalid order', {action:'refreshPayment',orderId:'../foreign'}, {WX_OPENID:'openid',WX_APPID:'app'}]
]) test(name + ' never reads the database or channel', async () => {
  let touched = false;
  const pool = {getConnection(){touched=true; throw new Error('must not touch');}};
  await assert.rejects(refreshPayment(pool,event,caller,{},async()=>{touched=true;}));
  assert.equal(touched,false);
});
