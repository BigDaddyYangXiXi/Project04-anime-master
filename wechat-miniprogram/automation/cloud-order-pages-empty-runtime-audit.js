const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const output = path.resolve(__dirname, "..", ".artifacts", "cloud-order-pages-empty");

async function open(miniProgram, route, screenshot) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(1800);
  await miniProgram.screenshot({ path: path.join(output, screenshot) });
  return page;
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    await miniProgram.evaluate(() => wx.setStorageSync("animeMasterRole", "buyer"));
    let page = await open(miniProgram, "/pages/orders/index", "01-buyer-orders-empty.png");
    let data = await page.data();
    assert.equal(data.role, "buyer");
    assert.equal(data.loading, false);
    assert.equal(data.loadError, "");
    assert.deepEqual(data.orders, []);

    await miniProgram.evaluate(() => wx.setStorageSync("animeMasterRole", "provider"));
    page = await open(miniProgram, "/pages/orders/index", "02-provider-orders-empty.png");
    data = await page.data();
    assert.equal(data.role, "provider");
    assert.equal(data.loading, false);
    assert.equal(data.loadError, "");
    assert.deepEqual(data.orders, []);

    page = await open(miniProgram, "/pages/booking/index?providerId=acct_missing", "03-booking-provider-missing.png");
    data = await page.data();
    assert.equal(data.loadingProvider, false);
    assert.equal(data.provider, null);

    page = await open(miniProgram, "/pages/booking-status/index?id=ord_missing", "04-order-missing.png");
    data = await page.data();
    assert.equal(data.loading, false);
    assert.equal(data.order, null);
    assert.match(data.loadError, /没有找到/);

    page = await open(miniProgram, "/pages/order-detail/index?id=ord_missing", "05-production-detail-missing.png");
    data = await page.data();
    assert.equal(data.loading, false);
    assert.equal(data.order, null);
    assert.match(data.loadError, /没有找到/);

    page = await open(miniProgram, "/pages/fulfillment/index?id=ord_missing", "06-fulfillment-missing.png");
    data = await page.data();
    assert.equal(data.loading, false);
    assert.equal(data.order, null);
    assert.match(data.loadError, /没有找到/);

    await miniProgram.evaluate(() => wx.setStorageSync("animeMasterRole", "buyer"));
    page = await open(miniProgram, "/pages/review/index?id=ord_missing", "07-review-order-missing.png");
    data = await page.data();
    assert.equal(data.loading, false);
    assert.equal(data.order, null);
    assert.match(data.loadError, /没有找到/);

    await miniProgram.evaluate(() => wx.setStorageSync("animeMasterRole", "provider"));
    page = await open(miniProgram, "/pages/provider-reviews/index", "08-provider-reviews-empty.png");
    data = await page.data();
    assert.equal(data.loading, false);
    assert.deepEqual(data.reviews, []);
    assert.equal(data.rating, "—");
    assert.equal(data.ratingBoundary, "综合算法待平台确认");

    console.log("Cloud order pages empty/error runtime audit passed through fulfillment, review and provider replies");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
