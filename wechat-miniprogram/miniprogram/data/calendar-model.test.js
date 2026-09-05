const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMonth, monthFrom, upcoming } = require("./calendar-model");

test("builds a real month with past, open, locked and unknown states", () => {
  const days = buildMonth({ year: 2026, month: 9, today: "2026-09-03", openDates: ["2026-09-04"], lockedDates: ["2026-09-05"], selectedDate: "2026-09-04" });
  assert.equal(days.length, 42);
  assert.equal(days.filter((item) => item.valid).length, 30);
  assert.equal(days.find((item) => item.date === "2026-09-02").past, true);
  assert.equal(days.find((item) => item.date === "2026-09-04").state, "open");
  assert.equal(days.find((item) => item.date === "2026-09-04").selected, true);
  assert.equal(days.find((item) => item.date === "2026-09-05").selectable, false);
  assert.equal(days.find((item) => item.date === "2026-09-06").state, "unknown");
});

test("uses the requested month and builds an eight-day public strip", () => {
  assert.deepEqual(monthFrom("2027-01-20"), { year: 2027, month: 1, title: "2027 年 1 月" });
  const days = upcoming(["2026-09-03"], ["2026-09-04"], 3, "2026-09-03");
  assert.deepEqual(days.map((item) => item.state), ["open-all", "full", "unknown"]);
});
