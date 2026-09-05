const assert = require("assert");

global.Page = (definition) => { global.pageDefinition = definition; };
global.wx = { showToast() {}, navigateTo() {} };
const { buildMonth } = require("../miniprogram/pages/provider-schedule/index.js");

const days = buildMonth(1, 18);
assert.strictEqual(days.length, 42);
assert.strictEqual(days.filter((day) => day.valid).length, 31);
assert.strictEqual(days.find((day) => day.value === 15).past, true);
assert.strictEqual(days.find((day) => day.value === 16).state, "open");
assert.strictEqual(days.find((day) => day.value === 18).selected, true);
assert.strictEqual(days.find((day) => day.value === 19).state, "full");
assert.strictEqual(days.find((day) => day.value === 19).selectable, false);
assert.strictEqual(days.find((day) => day.value === 23).state, "unknown");
assert.strictEqual(days.find((day) => day.value === 23).selectable, true);
assert.strictEqual(days.find((day) => day.value === 31).valid, true);
assert.deepStrictEqual(global.pageDefinition.data.weekdays, ["一", "二", "三", "四", "五", "六", "日"]);

process.stdout.write("B02C logic audit: 10 assertions passed\n");
