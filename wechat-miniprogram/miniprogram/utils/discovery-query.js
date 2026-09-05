const { filterOptions } = require("../data/catalog");

function serverFilters(cityCode, career, date, searchQuery, selectedFilters) {
  const priceLabels = selectedFilters.filter((item) => item.startsWith("￥"));
  let priceMinFen = null; let priceMaxFen = null;
  priceLabels.forEach((label) => {
    if (label === "￥300以下") priceMaxFen = 29999;
    if (label === "￥300–600") { priceMinFen = 30000; priceMaxFen = 60000; }
    if (label === "￥600以上") priceMinFen = 60001;
    if (label === "￥1000以下") priceMaxFen = 99999;
    if (label === "￥1000–2000") { priceMinFen = 100000; priceMaxFen = 200000; }
    if (label === "￥2000以上") priceMinFen = 200001;
  });
  const selectedTags = selectedFilters.filter((item) => !item.startsWith("￥"));
  const tagGroups = (filterOptions[career] || []).map((group) => group.values.filter((value) => selectedTags.includes(value) && !value.startsWith("￥"))).filter((group) => group.length);
  return { cityCode, career, date, query: searchQuery, tagGroups, priceMinFen, priceMaxFen, limit: 50 };
}
module.exports = { serverFilters };
