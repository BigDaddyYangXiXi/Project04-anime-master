function graphemes(value) {
  const text = String(value || "");
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

function truncateGraphemes(value, maximum) {
  return graphemes(value).slice(0, maximum).join("");
}

function sanitizeYuanInput(value) {
  const cleaned = String(value == null ? "" : value).replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  const integer = parts.shift() || "";
  if (!parts.length) return integer;
  return `${integer}.${parts.join("").slice(0, 2)}`;
}

module.exports = { graphemes, sanitizeYuanInput, truncateGraphemes };
