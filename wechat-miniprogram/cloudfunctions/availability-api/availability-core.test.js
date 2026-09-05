const test = require("node:test");
const assert = require("node:assert/strict");
const { chinaDate, handleAvailability, normalizeDates } = require("./availability-core");

const PROVIDER = "acct_provider";
function mockDb() {
  const availability = [];
  const orders = [{ provider_id: PROVIDER, stage: "IN_PRODUCTION", payload: JSON.stringify({ public: { timeSegments: [{ startsAt: Date.UTC(2026, 8, 20, 16) }] } }) }];
  return { availability, orders, from(table) {
    let operation = "select"; let value; const filters = [];
    const builder = {
      select() { return builder; }, eq(column, expected) { filters.push([column, expected]); return builder; },
      insert(input) { operation = "insert"; value = input; return builder; }, update(input) { operation = "update"; value = input; return builder; },
      then(resolve) {
        let source = table === "provider_availability" ? availability : table === "order_aggregates" ? orders :
          table === "wechat_identities" ? [{ open_id: "openid-provider", account_id: PROVIDER }] :
          table === "account_roles" ? [{ account_id: PROVIDER, role: "PROVIDER" }] : [];
        const matches = (row, column, expected) => column === "version" ? Number(row[column]) === Number(expected) : row[column] === expected;
        let data = source.filter((row) => filters.every(([column, expected]) => matches(row, column, expected)));
        if (table === "provider_availability" && operation === "insert") { availability.push(value); data = [value]; }
        if (table === "provider_availability" && operation === "update") {
          const row = availability.find((item) => filters.every(([column, expected]) => matches(item, column, expected)));
          data = row ? (Object.assign(row, value), [{ provider_id: row.provider_id }]) : [];
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      }
    };
    return builder;
  } };
}

test("normalizes China dates and rejects invalid or duplicate public dates", () => {
  assert.equal(chinaDate(Date.UTC(2026, 8, 20, 16)), "2026-09-21");
  assert.deepEqual(normalizeDates(["2026-09-22", "2026-09-21"], "2026-09-20"), ["2026-09-21", "2026-09-22"]);
  assert.throws(() => normalizeDates(["2026-09-21", "2026-09-21"], "2026-09-20"), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => normalizeDates(["2026-02-30"], "2026-02-01"), (error) => error.code === "VALIDATION_ERROR");
});

test("creates, reads and updates provider availability with a normalized version", async () => {
  const db = mockDb();
  const first = await handleAvailability(db, { action: "saveMine", expectedVersion: 0, openDates: ["2026-09-22"] }, { WX_OPENID: "openid-provider" }, Date.UTC(2026, 8, 20));
  assert.equal(first.version, 1);
  db.availability[0].version = "1";
  const read = await handleAvailability(db, { action: "getMine" }, { WX_OPENID: "openid-provider" }, Date.UTC(2026, 8, 20));
  assert.equal(read.version, 1);
  const second = await handleAvailability(db, { action: "saveMine", expectedVersion: read.version, openDates: ["2026-09-22", "2026-09-23"] }, { WX_OPENID: "openid-provider" }, Date.UTC(2026, 8, 20));
  assert.equal(second.version, 2);
});

test("derives locked dates from execution orders and rejects changing one", async () => {
  const db = mockDb();
  const read = await handleAvailability(db, { action: "getPublic", providerId: PROVIDER }, {}, Date.UTC(2026, 8, 20));
  assert.deepEqual(read.lockedDates, ["2026-09-21"]);
  await assert.rejects(
    () => handleAvailability(db, { action: "saveMine", expectedVersion: 0, openDates: ["2026-09-21"] }, { WX_OPENID: "openid-provider" }, Date.UTC(2026, 8, 20)),
    (error) => error.code === "LOCKED_DATE_MUTATION"
  );
});

test("rejects a caller without trusted provider identity", async () => {
  await assert.rejects(() => handleAvailability(mockDb(), { action: "getMine" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});

test("locks every occupied China date and protects the second day from editing", async () => {
  const db = mockDb();
  db.orders[0].payload = JSON.stringify({ public: { timeSegments: [{
    startsAt: Date.parse("2026-09-20T10:00:00+08:00"), endsAt: Date.parse("2026-09-21T18:00:00+08:00")
  }] } });
  const expected = ["2026-09-20", "2026-09-21"];
  const publicRead = await handleAvailability(db, { action: "getPublic", providerId: PROVIDER });
  const mine = await handleAvailability(db, { action: "getMine" }, { WX_OPENID: "openid-provider" });
  assert.deepEqual(publicRead.lockedDates, expected);
  assert.deepEqual(mine.lockedDates, expected);
  await assert.rejects(
    () => handleAvailability(db, { action: "saveMine", expectedVersion: 0, openDates: ["2026-09-21"] }, { WX_OPENID: "openid-provider" }, Date.parse("2026-09-19T00:00:00+08:00")),
    (error) => error.code === "LOCKED_DATE_MUTATION"
  );
  assert.deepEqual(db.availability, []);
});

test("excludes a midnight endpoint and includes a day with actual execution after midnight", async () => {
  const db = mockDb();
  for (const [endsAt, expected] of [
    ["2026-09-21T00:00:00+08:00", ["2026-09-20"]],
    ["2026-09-21T00:00:00.001+08:00", ["2026-09-20", "2026-09-21"]]
  ]) {
    db.orders[0].payload = JSON.stringify({ public: { timeSegments: [{ startsAt: Date.parse("2026-09-20T23:00:00+08:00"), endsAt: Date.parse(endsAt) }] } });
    const read = await handleAvailability(db, { action: "getPublic", providerId: PROVIDER });
    assert.deepEqual(read.lockedDates, expected);
  }
});

test("handles leap days, year boundaries and separate segments without locking the gap", async () => {
  const db = mockDb();
  const segments = [
    ["2028-02-28T12:00:00+08:00", "2028-03-01T08:00:00+08:00"],
    ["2028-03-01T18:00:00+08:00", "2028-03-01T20:00:00+08:00"],
    ["2028-12-31T12:00:00+08:00", "2029-01-01T12:00:00+08:00"]
  ].map(([start, end]) => ({ startsAt: Date.parse(start), endsAt: Date.parse(end) }));
  db.orders[0].payload = JSON.stringify({ public: { timeSegments: segments } });
  db.orders.push({ ...db.orders[0], stage: "COMPLETED", payload: JSON.stringify({ public: { timeSegments: [{ startsAt: Date.parse("2028-03-02T10:00:00+08:00"), endsAt: Date.parse("2028-03-03T10:00:00+08:00") }] } }) });
  const read = await handleAvailability(db, { action: "getPublic", providerId: PROVIDER });
  assert.deepEqual(read.lockedDates, ["2028-02-28", "2028-02-29", "2028-03-01", "2028-12-31", "2029-01-01"]);
});
