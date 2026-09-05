const test = require("node:test");
const assert = require("node:assert/strict");
const { graphemes, sanitizeYuanInput, truncateGraphemes } = require("./input-normalization");

test("nickname truncation preserves complete grapheme clusters", () => {
  const value = "👨‍👩‍👧‍👦".repeat(21);
  const truncated = truncateGraphemes(value, 20);
  assert.equal(graphemes(truncated).length, 20);
  assert.equal(truncated.endsWith("👨‍👩‍👧‍👦"), true);
});

test("yuan input preserves at most two decimal places instead of multiplying pasted values", () => {
  assert.equal(sanitizeYuanInput("680.50"), "680.50");
  assert.equal(sanitizeYuanInput("¥ 680.567"), "680.56");
  assert.equal(sanitizeYuanInput("6.8.5"), "6.85");
});
