function canonicalCityCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) return "";
  return new Set(["11", "12", "31", "50"]).has(code.slice(0, 2))
    ? `${code.slice(0, 2)}0000`
    : `${code.slice(0, 4)}00`;
}

function resolvedRegion(value) {
  const component = value && value.status === 0 && value.result && value.result.address_component;
  const cityCode = canonicalCityCode(value && value.result && value.result.ad_info && value.result.ad_info.adcode);
  if (!component || !cityCode) return null;
  return {
    provinceName: component.province || "",
    cityName: component.city || component.province || "",
    districtName: component.district || "",
    cityCode
  };
}

function geocoderUrl(latitude, longitude, key, secret) {
  const path = '/ws/geocoder/v1/';
  const location = `${latitude},${longitude}`;
  const query = `get_poi=0&key=${key}&location=${location}`;
  const sig = require('node:crypto').createHash('md5').update(path + '?' + query + secret).digest('hex');
  return `https://apis.map.qq.com${path}?get_poi=0&key=${encodeURIComponent(key)}&location=${encodeURIComponent(location)}&sig=${sig}`;
}

module.exports = { canonicalCityCode, resolvedRegion, geocoderUrl };
