const assert = require("node:assert/strict");
const { scheduleFromSegments, toClientOrder } = require("../miniprogram/services/cloud-orders");

const startsAt = new Date(2026, 8, 10, 9, 30).getTime();
const endsAt = new Date(2026, 8, 10, 12, 0).getTime();
const source = {
  id: "ord_1", buyerId: "acct_buyer", providerId: "acct_provider", viewerRole: "BUYER",
  buyer: { uid: "AM-BUYER", nickname: "阿遥" },
  provider: { uid: "AM-PROVIDER", nickname: "迟霜", career: "摄影" },
  stage: "REQUESTED", version: 1, createdAt: startsAt - 1000, updatedAt: startsAt - 1000,
  city: "杭州", cityCode: "330100", location: "场地待沟通", requirement: "完成一组角色摄影正片",
  referenceWorkId: "work_1", timeSegments: [{ startsAt, endsAt }],
  items: [{ serviceId: "service_1", name: "角色正片", displayPriceFen: 68000, finalPriceFen: 70000 }],
  amountFen: 70000, contact: null, paymentStatus: "PAID", progress: 100,
  deliveryNote: "正式交付完成", deliveryFiles: [{ name: "正片.pdf", fileId: "cloud://delivery.pdf", mimeType: "application/pdf", sizeBytes: 1024 }]
};

const order = toClientOrder(source);
assert.equal(order.cloudOrder, true);
assert.equal(order.buyer, "阿遥");
assert.equal(order.provider, "迟霜");
assert.equal(order.career, "摄影");
assert.equal(order.originalPrice, 680);
assert.equal(order.finalPrice, 700);
assert.equal(order.bookingDraft.workId, "work_1");
assert.equal(order.bookingDraft.timeMode, "continuous");
assert.equal(order.contact.wechat, "");
assert.equal(order.progress, 100);
assert.equal(order.deliveryFiles[0].fileId, "cloud://delivery.pdf");
assert.match(order.time, /2026\/09\/10 09:30—12:00/);

const multiple = scheduleFromSegments([
  { startsAt, endsAt },
  { startsAt: startsAt + 86400000, endsAt: endsAt + 86400000 }
]);
assert.equal(multiple.timeMode, "segments");
assert.equal(multiple.segments.length, 2);

console.log("Cloud order client mapping audit passed");
