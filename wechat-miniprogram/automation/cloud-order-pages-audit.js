const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const booking = read("miniprogram/pages/booking/index.js");
assert.match(booking, /cloudOrders\.createOrder/);
assert.match(booking, /idempotencyKey: this\.requestIdempotencyKey/);
assert.match(booking, /cloudCatalog\.uploadImage\([^]*"PROJECT_REFERENCE"\)/);
assert.match(booking, /!localPreview\.isAudit\(options\)/);

const orders = read("miniprogram/pages/orders/index.js");
assert.match(orders, /cloudOrders\.listOrders/);
assert.match(orders, /viewerRole === viewerRole/);

const buyer = read("miniprogram/pages/booking-status/index.js");
assert.match(buyer, /BUYER_SUPPLEMENTS/);
assert.match(buyer, /BUYER_SIGNS_NDA/);
assert.match(buyer, /BUYER_CONFIRMS_AGREEMENT/);
assert.match(buyer, /VERSION_CONFLICT/);

const provider = read("miniprogram/pages/provider-request/index.js");
[
  "PROVIDER_INTERESTED", "PROVIDER_REQUESTS_SUPPLEMENT", "PROVIDER_DECLINES",
  "PROVIDER_RECORDS_CONTACT", "PROVIDER_LOCKS_QUOTE", "PROVIDER_ENDS_COMMUNICATION",
  "PROVIDER_ENDS_COMMUNICATION_FAILED", "PROVIDER_UPDATES_PROGRESS", "PROVIDER_SUBMITS_DELIVERY"
].forEach((event) => assert.match(provider, new RegExp(event)));
assert.match(provider, /contactFirstCopiedAt/);
assert.match(provider, /cloudOrders\.uploadDeliveryFiles/);

const orderDetail = read("miniprogram/pages/order-detail/index.js");
assert.match(orderDetail, /cloudOrders\.getOrder/);
assert.match(orderDetail, /!localPreview\.isAudit\(options\)/);

const fulfillment = read("miniprogram/pages/fulfillment/index.js");
assert.match(fulfillment, /cloudOrders\.getOrder/);
assert.match(fulfillment, /BUYER_REQUESTS_REVISION/);
assert.match(fulfillment, /BUYER_ACCEPTS_DELIVERY/);
assert.match(fulfillment, /cloudOrders\.getDeliveryDownload/);
assert.match(fulfillment, /wx\.downloadFile/);
assert.doesNotMatch(fulfillment, /wx\.cloud\.downloadFile/);

const review = read("miniprogram/pages/review/index.js");
assert.match(review, /cloudOrders\.getOrder/);
assert.match(review, /BUYER_SUBMITS_REVIEW/);

const providerReviews = read("miniprogram/pages/provider-reviews/index.js");
assert.match(providerReviews, /cloudOrders\.listOrders/);
assert.match(providerReviews, /PROVIDER_REPLIES_REVIEW/);
assert.match(providerReviews, /综合算法待平台确认/);

const nda = read("miniprogram/pages/provider-task/index.js");
assert.match(nda, /PROVIDER_SIGNS_NDA/);
assert.match(nda, /VERSION_CONFLICT/);

[
  "miniprogram/pages/booking/index.wxml",
  "miniprogram/pages/orders/index.wxml",
  "miniprogram/pages/provider-orders/index.wxml",
  "miniprogram/pages/booking-status/index.wxml",
  "miniprogram/pages/provider-request/index.wxml",
  "miniprogram/pages/provider-task/index.wxml",
  "miniprogram/pages/order-detail/index.wxml",
  "miniprogram/pages/fulfillment/index.wxml",
  "miniprogram/pages/review/index.wxml",
  "miniprogram/pages/provider-reviews/index.wxml"
].forEach((file) => {
  const source = read(file);
  assert.match(source, /loading/);
  assert.match(source, /(重新加载|正在读取)/);
});

console.log("Cloud order pages audit passed: complete booking-phase read/write routes and visible async states exist");
