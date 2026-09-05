const assert = require("assert");
const presentation = require("../miniprogram/data/order-presentation");

const order = {
  buyer: "阿遥", buyerId: "buyer-ayao", provider: "南烛", providerId: 1,
  city: "杭州", time: "legacy", stage: "CONTACTING",
  bookingDraft: {
    timeMode: "segments",
    segments: [
      { startDate: "2026-08-25", startTime: "06:30", endDate: "2026-08-25", endTime: "09:00" },
      { startDate: "2026-08-26", startTime: "13:30", endDate: "2026-08-27", endTime: "16:00" }
    ]
  }
};
const schedule = presentation.scheduleFor(order);
assert.strictEqual(schedule.mode, "多个时段");
assert.deepStrictEqual(schedule.lines.map((item) => item.label), ["时段 1", "时段 2"]);
assert.strictEqual(schedule.lines[0].text, "2026/08/25 06:30—09:00");
assert.strictEqual(schedule.lines[1].text, "2026/08/26 13:30—2026/08/27 16:00");
assert.strictEqual(presentation.buyerIdentity(order).uid, "buyer-ayao");
assert.strictEqual(presentation.providerIdentity(order).uid, "@nanzhu_makeup");
assert.strictEqual(presentation.groupForStage("DECLINED"), "booking");
assert.strictEqual(presentation.groupForStage("DELIVERY_PENDING"), "execution");
assert.strictEqual(presentation.groupForStage("COMPLETED"), "history");
assert.deepStrictEqual(Object.keys(presentation.orderGroups), ["booking", "execution", "history"]);
process.stdout.write("Order identity, schedule and grouping audit: 10 assertions passed\n");
