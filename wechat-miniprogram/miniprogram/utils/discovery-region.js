function normalizeCityName(value) {
  return String(value || "").trim();
}

function canonicalCityCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(code.slice(0, 2))
    ? `${code.slice(0, 2)}0000`
    : `${code.slice(0, 4)}00`;
}

function pickerRegion(detail) {
  const names = detail && Array.isArray(detail.value) ? detail.value : [];
  const codes = detail && Array.isArray(detail.code) ? detail.code.map(String) : [];
  const cityCode = canonicalCityCode(codes[1] || codes[0] || "");
  if (names.length < 2 || !/^\d{6}$/.test(cityCode)) return null;
  return {
    provinceName: normalizeCityName(names[0]),
    cityName: normalizeCityName(names[1]) || normalizeCityName(names[0]),
    districtName: normalizeCityName(names[2]),
    cityCode
  };
}

function locationPreference(preference, maximumAgeMs, now = Date.now()) {
  if (!preference || !/^\d{6}$/.test(String(preference.cityCode || "")) || !normalizeCityName(preference.cityName)) return null;
  if (preference.source !== "LOCATED") return preference;
  return Number.isSafeInteger(preference.locatedAt) && now - preference.locatedAt <= maximumAgeMs ? preference : null;
}

module.exports = { canonicalCityCode, locationPreference, normalizeCityName, pickerRegion };
